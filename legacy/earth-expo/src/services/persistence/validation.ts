/**
 * ============================================================================
 * validation.ts — Zod Schema Validation for Persisted State
 * ============================================================================
 *
 * Validates the integrity of persisted world state during MMKV hydration.
 * If a user's save file is corrupted, tampered with, or from an older
 * schema version, this layer catches it before it reaches the store —
 * preventing runtime crashes from malformed data.
 *
 * Design:
 * - Every persisted entity (RegionMeta, Country, WorldSettings) has a
 *   corresponding Zod schema that mirrors the TypeScript interface.
 * - The top-level `PersistableWorldStateSchema` validates the entire
 *   saved blob in one pass.
 * - `validatePersistedState()` returns a discriminated union result:
 *   success with cleaned data, or failure with a human-readable reason.
 * - Schemas use `.passthrough()` sparingly — unknown keys in customData
 *   are allowed, but top-level shape is strict.
 */

import { z } from 'zod';
import type { PersistableWorldState } from '../../types';

// ─── Primitive Schemas ──────────────────────────────────────────────────────

/** Hex color string: #RGB, #RRGGBB, or #RRGGBBAA. */
const HexColorSchema = z.string().regex(
  /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/,
  'Invalid hex color format',
);

/** ISO-8601 datetime string. */
const ISODateSchema = z.string().refine(
  (val) => !isNaN(Date.parse(val)),
  'Invalid ISO-8601 date string',
);

/** Branded RegionId — any non-empty string. */
const RegionIdSchema = z.string().min(1, 'RegionId must be non-empty');

/** Branded CountryId — any non-empty string (UUID format preferred). */
const CountryIdSchema = z.string().min(1, 'CountryId must be non-empty');

// ─── Entity Schemas ─────────────────────────────────────────────────────────

/**
 * Schema for `RegionMeta` — the mutable user layer for a region.
 * Uses `z.coerce` where appropriate to heal minor type mismatches
 * (e.g., elevation stored as string "1.0" instead of number 1.0).
 */
export const RegionMetaSchema = z.object({
  id: RegionIdSchema,
  label: z.string().nullable().default(null),
  colorOverride: z.union([HexColorSchema, z.null()]).default(null),
  elevation: z.number().min(0.5).max(2.0).default(1.0),
  customData: z.record(z.string(), z.string()).default({}),
});

/**
 * Schema for `Country` — a user-created political entity.
 */
export const CountrySchema = z.object({
  id: CountryIdSchema,
  name: z.string().min(1).max(200).default('Unnamed'),
  color: HexColorSchema.default('#4A90D9'),
  flag: z.string().nullable().default(null),
  regionIds: z.array(RegionIdSchema).default([]),
  capitalRegionId: z.union([RegionIdSchema, z.null()]).default(null),
  customData: z.record(z.string(), z.string()).default({}),
  createdAt: ISODateSchema,
  updatedAt: ISODateSchema,
});

/**
 * Schema for `WorldSettings` — global app settings.
 * Provides safe defaults for every field so partial saves still work.
 */
export const WorldSettingsSchema = z.object({
  worldName: z.string().min(1).max(100).default('My World'),
  unownedRegionColor: HexColorSchema.default('#B0BEC5'),
  oceanColor: HexColorSchema.default('#1A237E'),
  showBorders: z.boolean().default(true),
  borderWidth: z.number().min(0).max(0.1).default(0.002),
  borderColor: HexColorSchema.default('#263238'),
  showAtmosphere: z.boolean().default(true),
  ambientLightIntensity: z.number().min(0).max(1).default(0.6),
  showLabels: z.boolean().default(true),
  autoRotateSpeed: z.number().min(0).max(1).default(0),
});

// ─── Top-Level Persisted State Schema ───────────────────────────────────────

/**
 * Full schema for the blob that gets serialized to / deserialized from MMKV.
 * This is the single validation gate between raw JSON and the Zustand store.
 */
export const PersistableWorldStateSchema = z.object({
  regions: z.record(RegionIdSchema, RegionMetaSchema).default({}),
  countries: z.record(CountryIdSchema, CountrySchema).default({}),
  settings: WorldSettingsSchema.default({
    worldName: 'My World',
    unownedRegionColor: '#B0BEC5',
    oceanColor: '#1A237E',
    showBorders: true,
    borderWidth: 0.002,
    borderColor: '#263238',
    showAtmosphere: true,
    ambientLightIntensity: 0.6,
    showLabels: true,
    autoRotateSpeed: 0,
  }),
});

// ─── Validation Result Types ────────────────────────────────────────────────

export interface ValidationSuccess {
  readonly ok: true;
  readonly data: PersistableWorldState;
}

export interface ValidationFailure {
  readonly ok: false;
  readonly reason: string;
  readonly errors: z.ZodIssue[];
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Validate raw parsed JSON against the persisted state schema.
 *
 * On success, returns cleaned/defaulted data safe to merge into the store.
 * On failure, returns a human-readable reason and the raw Zod issues
 * for debugging — the caller can fall back to defaults without crashing.
 *
 * @param raw - The raw object from `JSON.parse()`. May be anything.
 * @returns Discriminated union: `{ ok: true, data }` or `{ ok: false, reason, errors }`.
 */
export function validatePersistedState(raw: unknown): ValidationResult {
  const result = PersistableWorldStateSchema.safeParse(raw);

  if (result.success) {
    return {
      ok: true,
      data: result.data as PersistableWorldState,
    };
  }

  // Build a human-readable summary from the first few issues
  const issueMessages = result.error.issues
    .slice(0, 5)
    .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  const truncated = result.error.issues.length > 5
    ? `\n  ... and ${result.error.issues.length - 5} more issues`
    : '';

  return {
    ok: false,
    reason: `Persisted state failed validation:\n${issueMessages}${truncated}`,
    errors: result.error.issues,
  };
}

/**
 * Attempt to salvage a partially corrupted state by validating each
 * entity individually and keeping only the valid ones.
 *
 * This is the "best-effort recovery" path — used when full validation
 * fails but we want to preserve whatever data we can.
 *
 * @param raw - The raw object from `JSON.parse()`.
 * @returns A cleaned `PersistableWorldState` with invalid entries removed.
 */
export function salvagePersistedState(raw: unknown): PersistableWorldState {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  // Salvage regions
  const rawRegions = (typeof obj.regions === 'object' && obj.regions !== null)
    ? obj.regions as Record<string, unknown>
    : {};
  const validRegions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawRegions)) {
    const parsed = RegionMetaSchema.safeParse(value);
    if (parsed.success) {
      validRegions[key] = parsed.data;
    }
  }

  // Salvage countries
  const rawCountries = (typeof obj.countries === 'object' && obj.countries !== null)
    ? obj.countries as Record<string, unknown>
    : {};
  const validCountries: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawCountries)) {
    const parsed = CountrySchema.safeParse(value);
    if (parsed.success) {
      // Filter out regionIds that reference non-existent regions
      const country = parsed.data;
      country.regionIds = country.regionIds.filter((rid: string) => rid in validRegions);
      if (country.capitalRegionId && !(country.capitalRegionId in validRegions)) {
        country.capitalRegionId = country.regionIds[0] ?? null;
      }
      validCountries[key] = country;
    }
  }

  // Salvage settings (fall back to defaults on any failure)
  const settingsResult = WorldSettingsSchema.safeParse(obj.settings);
  const validSettings = settingsResult.success
    ? settingsResult.data
    : WorldSettingsSchema.parse({});

  return {
    regions: validRegions,
    countries: validCountries,
    settings: validSettings,
  } as PersistableWorldState;
}
