/**
 * ============================================================================
 * geoEditSlice.ts — Geographic Editing Actions (Fuse & Split)
 * ============================================================================
 *
 * This slice handles the state transitions that follow a successful
 * geometric fuse or split operation. The actual Turf.js math lives in
 * `services/geospatial/geoManipulation.ts` — this slice only manages
 * the *aftermath*: updating the Region/Country/Geometry dictionaries.
 *
 * ─── FUSE WORKFLOW ─────────────────────────────────────────────────────────
 *
 *   1. User selects two adjacent regions and taps "Fuse".
 *   2. UI calls `fuseRegions()` from geoManipulation.ts (async).
 *   3. On success, UI calls `completeFuse(idA, idB, fuseResult)`.
 *   4. This slice:
 *      a. Creates a new RegionGeometry with the merged polygon.
 *      b. Creates a new RegionMeta for the merged region.
 *      c. Deletes the two original regions from all dictionaries.
 *      d. Updates any Country that owned either region:
 *         - Remove old IDs from regionIds.
 *         - Add the new merged ID.
 *         - Fix capitalRegionId if it was one of the old IDs.
 *      e. Updates interaction state (selection, hover).
 *
 * ─── SPLIT WORKFLOW ────────────────────────────────────────────────────────
 *
 *   1. User draws a line across a region with the "Split" tool.
 *   2. UI calls `splitRegion()` from geoManipulation.ts (async).
 *   3. On success, UI calls `completeSplit(originalId, splitResult)`.
 *   4. This slice:
 *      a. Creates new RegionGeometry entries for each split part.
 *      b. Creates new RegionMeta entries (inheriting parent's metadata).
 *      c. Deletes the original region from all dictionaries.
 *      d. Updates the owning Country:
 *         - Remove the original ID.
 *         - Add all new part IDs.
 *         - Fix capitalRegionId if needed.
 *      e. Rebuilds the spatial index (handled by the component layer).
 */

import type { StateCreator } from 'zustand';
import type {
  WorldStore,
  RegionId,
  RegionGeometry,
  RegionMeta,
  CountryId,
} from '../../types';
import { regionId } from '../../types';
import type { FuseSuccess, SplitSuccess } from '../../services/geospatial/geoManipulation';
import { generateSplitRegionId } from '../../services/geospatial/geoManipulation';

// ─── Slice Interface ────────────────────────────────────────────────────────

export interface GeoEditSlice {
  /**
   * Complete a fuse operation by updating all store dictionaries.
   *
   * @param regionIdA   First region being fused (will be deleted).
   * @param regionIdB   Second region being fused (will be deleted).
   * @param result      The FuseSuccess result from geoManipulation.fuseRegions().
   * @param newId       Optional explicit ID for the merged region.
   *                    Defaults to `${regionIdA}+${regionIdB}`.
   * @returns           The RegionId of the newly created merged region.
   */
  completeFuse: (
    regionIdA: RegionId,
    regionIdB: RegionId,
    result: FuseSuccess,
    newId?: RegionId,
  ) => RegionId;

  /**
   * Complete a split operation by updating all store dictionaries.
   *
   * @param originalId  The region being split (will be deleted).
   * @param result      The SplitSuccess result from geoManipulation.splitRegion().
   * @returns           Array of RegionIds for the newly created parts.
   */
  completeSplit: (
    originalId: RegionId,
    result: SplitSuccess,
  ) => RegionId[];
}

// ─── Slice Implementation ──────────────────────────────────────────────────

export const createGeoEditSlice: StateCreator<WorldStore, [], [], GeoEditSlice> = (
  set,
  get,
) => ({
  completeFuse: (regionIdA, regionIdB, result, newId?) => {
    const state = get();
    const now = new Date().toISOString();

    // ── 1. Generate the new region ID ──────────────────────────────────
    // Convention: "US-CA+US-NV" for fused regions, preserving lineage.
    const mergedId = newId ?? regionId(`${regionIdA}+${regionIdB}`);

    // ── 2. Create the new RegionGeometry ───────────────────────────────
    const newGeometry: RegionGeometry = {
      id: mergedId,
      rings: result.rings,
      centroid: result.centroid,
      bbox: result.bbox,
      areaKm2: result.areaKm2,
    };

    // ── 3. Create new RegionMeta ───────────────────────────────────────
    // Inherit properties from region A (the "primary" region).
    // The user can always override these afterward.
    const metaA = state.regions[regionIdA];
    const metaB = state.regions[regionIdB];

    const newMeta: RegionMeta = {
      id: mergedId,
      label: metaA?.label ?? metaB?.label ?? null,
      colorOverride: metaA?.colorOverride ?? metaB?.colorOverride ?? null,
      elevation: metaA?.elevation ?? 1.0,
      customData: {
        ...(metaB?.customData ?? {}),
        ...(metaA?.customData ?? {}),
        fusedFrom: `${regionIdA},${regionIdB}`,
      },
    };

    // ── 4. Build updated dictionaries ──────────────────────────────────

    // Geometries: add merged, remove originals
    const geometries = { ...state.geometries };
    geometries[mergedId] = newGeometry;
    delete geometries[regionIdA];
    delete geometries[regionIdB];

    // Regions: add merged meta, remove originals
    const regions = { ...state.regions };
    regions[mergedId] = newMeta;
    delete regions[regionIdA];
    delete regions[regionIdB];

    // ── 5. Update Countries ────────────────────────────────────────────
    // Any country that owned either region A or B must now own the
    // merged region instead. If both belonged to the same country,
    // that country just swaps two IDs for one. If they belonged to
    // different countries, the merged region goes to country A's owner.

    const countries = { ...state.countries };
    let ownerCountryId: CountryId | null = null;

    for (const [cid, country] of Object.entries(countries)) {
      const hasA = country.regionIds.includes(regionIdA);
      const hasB = country.regionIds.includes(regionIdB);

      if (hasA || hasB) {
        // Remove old IDs
        let newRegionIds = country.regionIds.filter(
          (r) => r !== regionIdA && r !== regionIdB,
        );

        // The first country that owned either region gets the merged region
        if (!ownerCountryId) {
          ownerCountryId = cid as CountryId;
          newRegionIds = [...newRegionIds, mergedId];
        }
        // If a second country owned the other region, it just loses it
        // (the merged region belongs to the first owner)

        // Fix capital if it was one of the deleted regions
        let capitalRegionId = country.capitalRegionId;
        if (capitalRegionId === regionIdA || capitalRegionId === regionIdB) {
          capitalRegionId = mergedId;
        }

        countries[cid as CountryId] = {
          ...country,
          regionIds: newRegionIds,
          capitalRegionId,
          updatedAt: now,
        };
      }
    }

    // ── 6. Update interaction state ────────────────────────────────────
    // If the user had one of the deleted regions selected, select the
    // merged region instead.
    const interaction = { ...state.interaction };
    if (
      interaction.selectedRegionId === regionIdA ||
      interaction.selectedRegionId === regionIdB
    ) {
      interaction.selectedRegionId = mergedId;
    }
    if (
      interaction.hoveredRegionId === regionIdA ||
      interaction.hoveredRegionId === regionIdB
    ) {
      interaction.hoveredRegionId = null;
    }

    // ── 7. Apply all changes in a single atomic set() ──────────────────
    set({ geometries, regions, countries, interaction });

    return mergedId;
  },

  completeSplit: (originalId, result) => {
    const state = get();
    const now = new Date().toISOString();

    // ── 1. Generate new RegionIds for each part ────────────────────────
    const newIds: RegionId[] = result.parts.map((_, index) =>
      generateSplitRegionId(originalId, index),
    );

    // ── 2. Create new RegionGeometry entries ───────────────────────────
    const geometries = { ...state.geometries };
    const regions = { ...state.regions };

    const originalMeta = state.regions[originalId];

    for (let i = 0; i < result.parts.length; i++) {
      const part = result.parts[i];
      const id = newIds[i];

      // New geometry
      geometries[id] = {
        id,
        rings: part.rings,
        centroid: part.centroid,
        bbox: part.bbox,
        areaKm2: part.areaKm2,
      };

      // ── 3. Create new RegionMeta ─────────────────────────────────────
      // Each part inherits the parent's metadata.
      // Label gets a suffix to distinguish the parts.
      const suffix = String.fromCharCode(65 + i); // A, B, C, ...
      regions[id] = {
        id,
        label: originalMeta?.label
          ? `${originalMeta.label} ${suffix}`
          : null,
        colorOverride: originalMeta?.colorOverride ?? null,
        elevation: originalMeta?.elevation ?? 1.0,
        customData: {
          ...(originalMeta?.customData ?? {}),
          splitFrom: originalId,
          splitPart: suffix,
        },
      };
    }

    // ── 4. Delete the original region ──────────────────────────────────
    delete geometries[originalId];
    delete regions[originalId];

    // ── 5. Update Countries ────────────────────────────────────────────
    // The owning country loses the original ID and gains all new part IDs.
    const countries = { ...state.countries };

    for (const [cid, country] of Object.entries(countries)) {
      const idx = country.regionIds.indexOf(originalId);
      if (idx !== -1) {
        // Replace the original ID with all new part IDs at the same position
        const newRegionIds = [...country.regionIds];
        newRegionIds.splice(idx, 1, ...newIds);

        // Fix capital: if the original was the capital, make the largest
        // part the new capital (most likely what the user expects).
        let capitalRegionId = country.capitalRegionId;
        if (capitalRegionId === originalId) {
          // Find the largest part by area
          let maxArea = 0;
          let maxId = newIds[0];
          for (let i = 0; i < result.parts.length; i++) {
            if (result.parts[i].areaKm2 > maxArea) {
              maxArea = result.parts[i].areaKm2;
              maxId = newIds[i];
            }
          }
          capitalRegionId = maxId;
        }

        countries[cid as CountryId] = {
          ...country,
          regionIds: newRegionIds,
          capitalRegionId,
          updatedAt: now,
        };

        // A region belongs to at most one country
        break;
      }
    }

    // ── 6. Update interaction state ────────────────────────────────────
    const interaction = { ...state.interaction };
    if (interaction.selectedRegionId === originalId) {
      // Select the largest part
      interaction.selectedRegionId = newIds[0];
    }
    if (interaction.hoveredRegionId === originalId) {
      interaction.hoveredRegionId = null;
    }

    // ── 7. Apply all changes atomically ────────────────────────────────
    set({ geometries, regions, countries, interaction });

    return newIds;
  },
});
