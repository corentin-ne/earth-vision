/**
 * ============================================================================
 * settingsSlice.ts — WorldSettings Actions
 * ============================================================================
 *
 * Manages the global WorldSettings that govern the look & feel of the
 * sandbox world. Persisted to MMKV.
 */

import type { StateCreator } from 'zustand';
import type { WorldStore, WorldSettings } from '../../types';
import {
  DEFAULT_WORLD_NAME,
  DEFAULT_UNOWNED_COLOR,
  DEFAULT_OCEAN_COLOR,
  DEFAULT_BORDER_COLOR,
  DEFAULT_BORDER_WIDTH,
  DEFAULT_AMBIENT_INTENSITY,
} from '../../constants';

export interface SettingsSlice {
  settings: WorldSettings;
  updateSettings: (patch: Partial<WorldSettings>) => void;
}

export const DEFAULT_SETTINGS: WorldSettings = {
  worldName: DEFAULT_WORLD_NAME,
  unownedRegionColor: DEFAULT_UNOWNED_COLOR,
  oceanColor: DEFAULT_OCEAN_COLOR,
  showBorders: true,
  borderWidth: DEFAULT_BORDER_WIDTH,
  borderColor: DEFAULT_BORDER_COLOR,
  showAtmosphere: true,
  ambientLightIntensity: DEFAULT_AMBIENT_INTENSITY,
  showLabels: false,
  autoRotateSpeed: 0.1,
};

export const createSettingsSlice: StateCreator<WorldStore, [], [], SettingsSlice> = (
  set,
  get,
) => ({
  settings: { ...DEFAULT_SETTINGS },

  updateSettings: (patch) => {
    set({
      settings: { ...get().settings, ...patch },
    });
  },
});
