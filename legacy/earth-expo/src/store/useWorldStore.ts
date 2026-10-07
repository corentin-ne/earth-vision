/**
 * ============================================================================
 * useWorldStore.ts — Main Zustand Store (Slice Composition)
 * ============================================================================
 *
 * Composes all domain slices into a single Zustand store with auto-persist
 * middleware. This is the ONLY file that creates the store — all consumers
 * import `useWorldStore` from here.
 *
 * Slice Pattern:
 *   Each slice defines its own state shape + actions. The main store
 *   merges them using the spread pattern inside `create()`. Because
 *   Zustand stores are flat objects, there's no nesting overhead.
 */

import { create } from 'zustand';
import type { WorldStore } from '../types';

import { createRegionSlice } from './slices/regionSlice';
import { createCountrySlice } from './slices/countrySlice';
import { createCameraSlice } from './slices/cameraSlice';
import { createInteractionSlice } from './slices/interactionSlice';
import { createSettingsSlice } from './slices/settingsSlice';
import { createGeoEditSlice } from './slices/geoEditSlice';
import { createPersistMiddleware } from './middleware/persistMiddleware';
import { saveState, loadState } from '../services/persistence/mmkvStorage';

// ─── Middleware ─────────────────────────────────────────────────────────────

const persistMiddleware = createPersistMiddleware(saveState, loadState);

// ─── Store ──────────────────────────────────────────────────────────────────

export const useWorldStore = create<WorldStore>()(
  persistMiddleware((...args) => ({
    ...createRegionSlice(...args),
    ...createCountrySlice(...args),
    ...createCameraSlice(...args),
    ...createInteractionSlice(...args),
    ...createSettingsSlice(...args),
    ...createGeoEditSlice(...args),

    // Persistence actions are injected by the middleware itself
    persist: () => {},
    rehydrate: () => {},
    resetWorld: () => {},
  })),
);

// ─── Selectors (Convenience) ────────────────────────────────────────────────

/** Get the Country that owns a given region, or null. */
export function getCountryForRegion(
  state: WorldStore,
  regionId: import('../types').RegionId,
): import('../types').Country | null {
  for (const country of Object.values(state.countries)) {
    if (country.regionIds.includes(regionId)) return country;
  }
  return null;
}

/** Get all RegionMeta records for a given country. */
export function getRegionsForCountry(
  state: WorldStore,
  countryId: import('../types').CountryId,
): import('../types').RegionMeta[] {
  const country = state.countries[countryId];
  if (!country) return [];
  return country.regionIds
    .map((rid) => state.regions[rid])
    .filter(Boolean);
}

/** Get all RegionMeta records that belong to no country. */
export function getUnownedRegions(state: WorldStore): import('../types').RegionMeta[] {
  const ownedIds = new Set<string>();
  for (const country of Object.values(state.countries)) {
    for (const rid of country.regionIds) {
      ownedIds.add(rid);
    }
  }
  return Object.values(state.regions).filter((r) => !ownedIds.has(r.id));
}
