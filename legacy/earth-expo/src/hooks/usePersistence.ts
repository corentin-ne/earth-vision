/**
 * ============================================================================
 * usePersistence.ts — Rehydration & Auto-Save Hook (Hardened)
 * ============================================================================
 *
 * Initializes MMKV storage and rehydrates the store on mount.
 * Should be called once at the app root level.
 *
 * SDK 54 Changes:
 * - Uses async initialization (initStorageAsync) to derive the MMKV
 *   encryption key from expo-secure-store (platform keychain).
 * - Falls back to synchronous init if async path fails.
 * - Rehydration failures are caught and suppressed — the app boots
 *   with a clean default state rather than crashing.
 * - Zod validation happens inside `mmkvStorage.loadState()` before
 *   data ever reaches the store.
 */

import { useEffect, useRef, useState } from 'react';
import { useWorldStore } from '../store/useWorldStore';
import { initStorageAsync, initStorage } from '../services/persistence/mmkvStorage';

/**
 * Initializes encrypted storage and rehydrates persisted state.
 *
 * @returns `{ isReady: boolean }` — true once rehydration is complete.
 */
export function usePersistence() {
  const [isReady, setIsReady] = useState(false);
  const didInit = useRef(false);
  const rehydrate = useWorldStore((s) => s.rehydrate);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    async function initialize() {
      try {
        // Prefer async init — derives encryption key from platform keychain
        await initStorageAsync();
      } catch {
        // Fall back to synchronous init with static key
        try {
          initStorage();
        } catch {
          // Even sync init failed — app will use in-memory storage
        }
      }

      try {
        rehydrate();
      } catch {
        // Rehydration failed — app will use default state
        // Zod validation in mmkvStorage already attempted salvage
      }

      setIsReady(true);
    }

    initialize();
  }, [rehydrate]);

  return { isReady };
}
