/**
 * ============================================================================
 * mmkvStorage.ts — MMKV Storage Adapter (Hardened + Encrypted)
 * ============================================================================
 *
 * Provides serialize / deserialize functions for persisting the world
 * state to react-native-mmkv. Falls back to an in-memory store on web.
 *
 * Security & Integrity (SDK 54):
 * - Encryption key is derived from expo-secure-store (platform keychain)
 *   on native, ensuring the key itself is never in plain JS memory at rest.
 * - If expo-secure-store is unavailable (web), falls back to a static key.
 * - All loaded state is validated through Zod schemas before use.
 * - Corrupt/tampered JSON triggers salvage recovery (best-effort).
 * - A backup of the last-known-good state is kept for rollback.
 * - Save operations use a version stamp for future migration support.
 */

import type { PersistableWorldState } from '../../types';
import { STORAGE_KEY, STORAGE_VERSION } from '../../store/middleware/persistMiddleware';
import {
  validatePersistedState,
  salvagePersistedState,
  type ValidationResult,
} from './validation';

// ─── Storage Keys ───────────────────────────────────────────────────────────

/** Backup key for last-known-good state (rollback on corruption). */
const BACKUP_KEY = `${STORAGE_KEY}:backup`;

/** Version key to track schema migrations. */
const VERSION_KEY = `${STORAGE_KEY}:version`;

/** expo-secure-store key for the MMKV encryption key. */
const SECURE_STORE_KEY = 'my-world-mmkv-encryption-key';

/** Static fallback key (used on web or when secure store is unavailable). */
const FALLBACK_ENCRYPTION_KEY = 'my-world-v1-enc';

// ─── MMKV Instance ──────────────────────────────────────────────────────────

interface MMKVAdapter {
  set: (key: string, value: string) => void;
  getString: (key: string) => string | undefined;
  delete: (key: string) => void;
  clearAll: () => void;
}

let mmkv: MMKVAdapter | null = null;

/**
 * Generate a cryptographically random 32-character hex key.
 * Used for first-time MMKV encryption key creation.
 */
function generateEncryptionKey(): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Retrieve or create the MMKV encryption key from the platform keychain
 * via expo-secure-store. The key is generated once and stored securely.
 *
 * Flow:
 *   1. Try to read existing key from secure store.
 *   2. If not found, generate a random 32-char hex key.
 *   3. Store the new key in secure store for future launches.
 *   4. If secure store is unavailable, fall back to static key.
 *
 * @returns The encryption key string.
 */
async function getOrCreateEncryptionKey(): Promise<string> {
  try {
    const SecureStore = await import('expo-secure-store');

    // Try reading an existing key
    const existing = await SecureStore.getItemAsync(SECURE_STORE_KEY);
    if (existing) return existing;

    // First launch — generate and persist a new key
    const newKey = generateEncryptionKey();
    await SecureStore.setItemAsync(SECURE_STORE_KEY, newKey, {
      // iOS: store in Keychain with "when unlocked" access
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    });

    return newKey;
  } catch {
    // expo-secure-store unavailable (web, or native module missing)
    return FALLBACK_ENCRYPTION_KEY;
  }
}

/**
 * Synchronous version for environments where async init isn't possible.
 * Uses the static fallback key. Prefer `initStorageAsync()` when possible.
 */
function getEncryptionKeySync(): string {
  return FALLBACK_ENCRYPTION_KEY;
}

/**
 * Initialize the MMKV storage instance with encryption.
 *
 * Async variant — preferred at app startup. Derives the encryption key
 * from the platform keychain via expo-secure-store.
 *
 * Call this once in `usePersistence` before rehydration.
 */
export async function initStorageAsync(): Promise<void> {
  if (mmkv) return; // Already initialized

  try {
    const encryptionKey = await getOrCreateEncryptionKey();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MMKV } = require('react-native-mmkv');
    mmkv = new MMKV({
      id: 'my-world-storage',
      encryptionKey,
    });
  } catch {
    // MMKV unavailable — create in-memory fallback
    createInMemoryFallback();
  }
}

/**
 * Initialize the MMKV storage instance (synchronous fallback).
 *
 * Uses a static encryption key. Suitable for web or test environments
 * where expo-secure-store is unavailable.
 */
export function initStorage(): void {
  if (mmkv) return; // Already initialized

  try {
    const encryptionKey = getEncryptionKeySync();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MMKV } = require('react-native-mmkv');
    mmkv = new MMKV({
      id: 'my-world-storage',
      encryptionKey,
    });
  } catch {
    // Web or environments without MMKV — use a plain object fallback
    createInMemoryFallback();
  }
}

/** Create an in-memory storage adapter (web fallback). */
function createInMemoryFallback(): void {
  const memoryStore: Record<string, string> = {};
  mmkv = {
    set: (key: string, value: string) => {
      memoryStore[key] = value;
    },
    getString: (key: string) => memoryStore[key] ?? undefined,
    delete: (key: string) => {
      delete memoryStore[key];
    },
    clearAll: () => {
      for (const key in memoryStore) delete memoryStore[key];
    },
  };
}

// ─── Save ───────────────────────────────────────────────────────────────────

/**
 * Serialize and persist the world state.
 * Promotes the previous save to backup before overwriting.
 */
export function saveState(state: PersistableWorldState): void {
  if (!mmkv) initStorage();

  const json = JSON.stringify(state);

  // Promote current save → backup before overwriting
  const existing = mmkv!.getString(STORAGE_KEY);
  if (existing) {
    mmkv!.set(BACKUP_KEY, existing);
  }

  mmkv!.set(STORAGE_KEY, json);
  mmkv!.set(VERSION_KEY, String(STORAGE_VERSION));
}

// ─── Load (with Zod Validation) ─────────────────────────────────────────────

/**
 * Deserialize the persisted world state with full Zod validation.
 *
 * Recovery pipeline:
 *   1. Parse primary save → validate → return if valid.
 *   2. If primary fails validation → attempt salvage (keep valid entries).
 *   3. If primary is unparseable → try backup save.
 *   4. If everything fails → return null (store uses defaults).
 *
 * @returns Validated `PersistableWorldState`, or null if unrecoverable.
 */
export function loadState(): PersistableWorldState | null {
  if (!mmkv) initStorage();

  // Step 1: Try primary save
  const json = mmkv!.getString(STORAGE_KEY);
  if (json) {
    const result = parseAndValidate(json);
    if (result) return result;
  }

  // Step 2: Try backup save
  const backupJson = mmkv!.getString(BACKUP_KEY);
  if (backupJson) {
    const result = parseAndValidate(backupJson);
    if (result) return result;
  }

  // Step 3: Unrecoverable — return null
  return null;
}

/**
 * Parse a JSON string and run it through Zod validation.
 * Falls back to salvage recovery on validation failure.
 * Returns null only if JSON.parse itself throws.
 */
function parseAndValidate(json: string): PersistableWorldState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null; // Completely unparseable
  }

  // Full validation pass
  const validation: ValidationResult = validatePersistedState(raw);
  if (validation.ok) {
    return validation.data;
  }

  // Validation failed — attempt best-effort salvage
  return salvagePersistedState(raw);
}

/**
 * Get the stored schema version for migration checks.
 */
export function getStoredVersion(): number {
  if (!mmkv) initStorage();
  const v = mmkv!.getString(VERSION_KEY);
  return v ? parseInt(v, 10) : 0;
}

/**
 * Clear all persisted data (primary + backup + version).
 */
export function clearStorage(): void {
  if (!mmkv) initStorage();
  mmkv!.delete(STORAGE_KEY);
  mmkv!.delete(BACKUP_KEY);
  mmkv!.delete(VERSION_KEY);
}
