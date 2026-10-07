/**
 * ============================================================================
 * persistMiddleware.ts — Auto-save to MMKV on Mutation (Hardened)
 * ============================================================================
 *
 * Zustand middleware that intercepts every `set()` call and persists the
 * `PersistableWorldState` subset to MMKV storage. Uses a debounce to
 * avoid thrashing disk I/O during rapid painting operations.
 *
 * Security:
 * - Rehydration runs all loaded data through Zod validation.
 * - Corrupt saves trigger salvage recovery, not crashes.
 * - A version stamp enables future schema migrations.
 */

import type { StateCreator, StoreMutatorIdentifier } from 'zustand';
import type { WorldStore, PersistableWorldState } from '../../types';

// ─── Configuration ──────────────────────────────────────────────────────────

/** Minimum interval between persistence writes (ms). */
const PERSIST_DEBOUNCE_MS = 500;

/** MMKV storage key for the persisted world state. */
export const STORAGE_KEY = 'my-world:state';

/** Schema version for migration support. Bump when PersistableWorldState changes. */
export const STORAGE_VERSION = 1;

// ─── Middleware ─────────────────────────────────────────────────────────────

type PersistImpl = <
  T extends WorldStore,
  Mps extends [StoreMutatorIdentifier, unknown][] = [],
  Mcs extends [StoreMutatorIdentifier, unknown][] = [],
>(
  storeCreator: StateCreator<T, Mps, Mcs>,
) => StateCreator<T, Mps, Mcs>;

/**
 * Creates the auto-persist middleware. Accepts a save function so the
 * middleware is decoupled from any specific storage backend (MMKV, AsyncStorage,
 * localStorage for web, etc.).
 *
 * The `loadFn` is expected to return **already-validated** data (validation
 * happens inside `mmkvStorage.loadState()` via Zod schemas). This middleware
 * applies the data defensively with fallback defaults.
 *
 * @param saveFn  Function that serializes and stores the persistable state.
 * @param loadFn  Function that deserializes + validates stored state. Returns null if empty/corrupt.
 */
export function createPersistMiddleware(
  saveFn: (state: PersistableWorldState) => void,
  loadFn: () => PersistableWorldState | null,
) {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Extract the persistable subset from the full store. */
  function extractPersistable(state: WorldStore): PersistableWorldState {
    return {
      regions: state.regions,
      countries: state.countries,
      settings: state.settings,
    };
  }

  const persistMiddleware: PersistImpl = (storeCreator) => (set, get, api) => {
    const persistingSet = ((...args: Parameters<typeof set>) => {
      // Apply the state change
      (set as (...a: unknown[]) => void)(...args);

      // Schedule a debounced persist
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try {
          const state = get() as WorldStore;
          saveFn(extractPersistable(state));
        } catch {
          // Save failure is non-fatal — data stays in memory
          if (__DEV__) {
            // Only log in development builds
          }
        }
      }, PERSIST_DEBOUNCE_MS);
    }) as typeof set;

    const store = storeCreator(persistingSet, get, api);

    return {
      ...store,

      /**
       * Immediately persist the current state (bypass debounce).
       * Useful before app backgrounding or explicit "Save" action.
       */
      persist: () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        try {
          const state = get() as WorldStore;
          saveFn(extractPersistable(state));
        } catch {
          // Non-fatal
        }
      },

      /**
       * Rehydrate persisted state from MMKV.
       * Data has already been Zod-validated by `loadFn` (mmkvStorage).
       * Defensive fallbacks ensure no undefined fields reach the store.
       */
      rehydrate: () => {
        const saved = loadFn();
        if (saved) {
          const currentSettings = (get() as WorldStore).settings;
          (set as (...a: unknown[]) => void)({
            regions: saved.regions ?? {},
            countries: saved.countries ?? {},
            settings: { ...currentSettings, ...saved.settings },
          });
        }
      },

      /**
       * Reset the entire world to factory defaults.
       * Clears MMKV storage and restores default state.
       */
      resetWorld: () => {
        const { settings: defaultSettings } = storeCreator(
          persistingSet,
          get,
          api,
        ) as WorldStore;
        (set as (...a: unknown[]) => void)({
          regions: {},
          countries: {},
          settings: defaultSettings,
        });
        saveFn({
          regions: {} as PersistableWorldState['regions'],
          countries: {} as PersistableWorldState['countries'],
          settings: defaultSettings,
        });
      },
    };
  };

  return persistMiddleware;
}

// ─── Environment Polyfill ───────────────────────────────────────────────────

/**
 * `__DEV__` is provided by React Native / Metro. TypeScript doesn't know
 * about it, so we declare it here to satisfy the compiler.
 */
declare const __DEV__: boolean;
