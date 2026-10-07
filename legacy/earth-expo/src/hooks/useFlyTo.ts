/**
 * ============================================================================
 * useFlyTo.ts — Imperative Camera API
 * ============================================================================
 *
 * Provides a `flyTo(lat, lon, zoom?)` function that triggers a smooth
 * spring-animated camera transition via the store's cameraSlice.
 *
 * Country-aware: when a region belongs to a country, the camera frames
 * the entire country's combined bounding box (cinematic, wide shot).
 * Otherwise, it frames the single region.
 */

import { useCallback } from 'react';
import { useWorldStore, getCountryForRegion } from '../store/useWorldStore';
import { computeZoomDistance } from '../utils/math/camera';
import { getCountryBbox, getCountryCentroid } from '../services/geospatial/regionOps';
import { DEFAULT_CAMERA_DISTANCE } from '../constants';
import type { RegionId } from '../types';

/**
 * Returns a `flyTo` function that animates the camera to a [lon, lat] target.
 *
 * @returns `(lon: number, lat: number, bbox?: ...) => void`
 */
export function useFlyTo() {
  const flyTo = useWorldStore((s) => s.flyTo);

  return useCallback(
    (
      lon: number,
      lat: number,
      bbox?: readonly [west: number, south: number, east: number, north: number],
    ) => {
      const distance = bbox
        ? computeZoomDistance(bbox)
        : DEFAULT_CAMERA_DISTANCE;
      flyTo([lon, lat], distance);
    },
    [flyTo],
  );
}

/**
 * Returns a function that flies to a region, with country-awareness.
 *
 * If the region belongs to a country, the camera frames the whole country.
 * If the region is unowned, the camera frames the single region.
 */
export function useFlyToRegion() {
  const flyTo = useWorldStore((s) => s.flyTo);

  return useCallback(
    (regionId: RegionId) => {
      const state = useWorldStore.getState();
      const geom = state.geometries[regionId];
      if (!geom) return;

      // Check if the region belongs to a country
      const country = getCountryForRegion(state, regionId);

      if (country && country.regionIds.length > 1) {
        // Fly to the whole country (cinematic, wider shot)
        const countryBbox = getCountryBbox(country, state.geometries);
        const countryCentroid = getCountryCentroid(country, state.geometries);

        if (countryBbox && countryCentroid) {
          const distance = computeZoomDistance(countryBbox);
          flyTo(countryCentroid, distance);
          return;
        }
      }

      // Fly to the single region
      const [lon, lat] = geom.centroid;
      const distance = computeZoomDistance(geom.bbox);
      flyTo([lon, lat], distance);
    },
    [flyTo],
  );
}
