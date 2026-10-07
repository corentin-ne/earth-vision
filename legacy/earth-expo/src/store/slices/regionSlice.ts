/**
 * ============================================================================
 * regionSlice.ts — Region Mutation Actions
 * ============================================================================
 *
 * Manages the mutable `RegionMeta` layer. Geometry is immutable and handled
 * separately via `loadGeometries`.
 */

import type { StateCreator } from 'zustand';
import type { WorldStore, RegionId, RegionMeta, RegionGeometry } from '../../types';

export interface RegionSlice {
  regions: Record<RegionId, RegionMeta>;
  geometries: Record<RegionId, RegionGeometry>;

  loadGeometries: (geometries: Record<RegionId, RegionGeometry>) => void;
  updateRegion: (id: RegionId, patch: Partial<Omit<RegionMeta, 'id'>>) => void;
}

export const createRegionSlice: StateCreator<WorldStore, [], [], RegionSlice> = (
  set,
  get,
) => ({
  regions: {} as Record<RegionId, RegionMeta>,
  geometries: {} as Record<RegionId, RegionGeometry>,

  loadGeometries: (geometries) => {
    // Initialize RegionMeta for any region that doesn't already have one
    const existing = get().regions;
    const regions = { ...existing };

    for (const id of Object.keys(geometries) as RegionId[]) {
      if (!regions[id]) {
        regions[id] = {
          id,
          label: null,
          colorOverride: null,
          elevation: 1.0,
          customData: {},
        };
      }
    }

    set({ geometries, regions });
  },

  updateRegion: (id, patch) => {
    const current = get().regions[id];
    if (!current) return;

    // Clamp elevation to safe range
    let elevation = patch.elevation ?? current.elevation;
    elevation = Math.max(0.98, Math.min(1.5, elevation));

    set({
      regions: {
        ...get().regions,
        [id]: { ...current, ...patch, elevation },
      },
    });
  },
});
