/**
 * ============================================================================
 * interactionSlice.ts — Selection & Tool State
 * ============================================================================
 *
 * Manages transient UI interaction state: which region is selected,
 * which tool is active, hover state, etc. Never persisted.
 */

import type { StateCreator } from 'zustand';
import type {
  WorldStore,
  RegionId,
  CountryId,
  EditorTool,
  InteractionState,
} from '../../types';

export interface InteractionSlice {
  interaction: InteractionState;

  selectRegion: (id: RegionId | null) => void;
  selectCountry: (id: CountryId | null) => void;
  setHoveredRegion: (id: RegionId | null) => void;
  setActiveTool: (tool: EditorTool) => void;
  setPaintCountry: (id: CountryId | null) => void;
  toggleBottomSheet: (open?: boolean) => void;
}

const DEFAULT_INTERACTION: InteractionState = {
  selectedRegionId: null,
  selectedCountryId: null,
  hoveredRegionId: null,
  activeTool: 'select',
  paintCountryId: null,
  isBottomSheetOpen: false,
};

export const createInteractionSlice: StateCreator<
  WorldStore,
  [],
  [],
  InteractionSlice
> = (set) => ({
  interaction: { ...DEFAULT_INTERACTION },

  selectRegion: (id) => {
    set((state) => ({
      interaction: { ...state.interaction, selectedRegionId: id },
    }));
  },

  selectCountry: (id) => {
    set((state) => ({
      interaction: { ...state.interaction, selectedCountryId: id },
    }));
  },

  setHoveredRegion: (id) => {
    set((state) => ({
      interaction: { ...state.interaction, hoveredRegionId: id },
    }));
  },

  setActiveTool: (tool) => {
    set((state) => ({
      interaction: { ...state.interaction, activeTool: tool },
    }));
  },

  setPaintCountry: (id) => {
    set((state) => ({
      interaction: { ...state.interaction, paintCountryId: id },
    }));
  },

  toggleBottomSheet: (open) => {
    set((state) => ({
      interaction: {
        ...state.interaction,
        isBottomSheetOpen: open ?? !state.interaction.isBottomSheetOpen,
      },
    }));
  },
});
