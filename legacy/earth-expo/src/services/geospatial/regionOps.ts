/**
 * ============================================================================
 * regionOps.ts — Region Geospatial Operations
 * ============================================================================
 *
 * Higher-level operations on regions that leverage Turf.js:
 * • Compute combined bounding box for a country
 * • Get aggregate area for a set of regions
 * • Determine adjacency between regions (shared border)
 * • Simplify region geometry for lower LOD rendering
 */

import type { RegionGeometry, RegionId, CountryId, Country } from '../../types';
import {
  computeArea,
  computeBbox,
  combineBboxes,
  simplifyPolygon,
  isPointInPolygon,
} from './turfService';

// ─── Country-level aggregate operations ─────────────────────────────────────

/**
 * Compute the combined bounding box that encloses all regions of a country.
 */
export function getCountryBbox(
  country: Country,
  geometries: Record<string, RegionGeometry>,
): [west: number, south: number, east: number, north: number] | null {
  const bboxes: Array<readonly [number, number, number, number]> = [];

  for (const rid of country.regionIds) {
    const geom = geometries[rid];
    if (geom?.bbox) {
      bboxes.push(geom.bbox);
    }
  }

  if (bboxes.length === 0) return null;
  return combineBboxes(bboxes) as [number, number, number, number];
}

/**
 * Compute the weighted centroid for a country (average of region centroids
 * weighted by area).
 */
export function getCountryCentroid(
  country: Country,
  geometries: Record<string, RegionGeometry>,
): [lon: number, lat: number] | null {
  let totalArea = 0;
  let lonSum = 0;
  let latSum = 0;

  for (const rid of country.regionIds) {
    const geom = geometries[rid];
    if (!geom) continue;
    const area = geom.areaKm2 || 1;
    lonSum += geom.centroid[0] * area;
    latSum += geom.centroid[1] * area;
    totalArea += area;
  }

  if (totalArea === 0) return null;
  return [lonSum / totalArea, latSum / totalArea];
}

/**
 * Sum the total area of all regions belonging to a country.
 */
export function getCountryArea(
  country: Country,
  geometries: Record<string, RegionGeometry>,
): number {
  let total = 0;
  for (const rid of country.regionIds) {
    const geom = geometries[rid];
    if (geom) total += geom.areaKm2;
  }
  return total;
}

// ─── Adjacency ──────────────────────────────────────────────────────────────

/**
 * Determine if two regions share a border (any point of one polygon
 * lies within a small buffer of the other).
 *
 * This is an approximation — for precise adjacency, a topology check
 * (shared arcs in TopoJSON) would be needed.
 */
export function areRegionsAdjacent(
  a: RegionGeometry,
  b: RegionGeometry,
  toleranceDeg: number = 0.5,
): boolean {
  // Quick bbox reject
  const [aw, as_, ae, an] = a.bbox;
  const [bw, bs, be, bn] = b.bbox;

  if (ae + toleranceDeg < bw || be + toleranceDeg < aw) return false;
  if (an + toleranceDeg < bs || bn + toleranceDeg < as_) return false;

  // Sample a few points from each ring
  for (const ring of a.rings) {
    for (let i = 0; i < ring.length; i += Math.max(1, Math.floor(ring.length / 10))) {
      const [lon, lat] = ring[i];
      // Check if this point is near any ring of B
      for (const ringB of b.rings) {
        for (let j = 0; j < ringB.length; j++) {
          const [lon2, lat2] = ringB[j];
          const dLon = Math.abs(lon - lon2);
          const dLat = Math.abs(lat - lat2);
          if (dLon < toleranceDeg && dLat < toleranceDeg) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

/**
 * Find all regions adjacent to a given region.
 */
export function findAdjacentRegions(
  regionId: RegionId,
  geometries: Record<string, RegionGeometry>,
  toleranceDeg?: number,
): RegionId[] {
  const target = geometries[regionId];
  if (!target) return [];

  const adjacent: RegionId[] = [];

  for (const [rid, geom] of Object.entries(geometries)) {
    if (rid === regionId) continue;
    if (areRegionsAdjacent(target, geom, toleranceDeg)) {
      adjacent.push(rid as RegionId);
    }
  }

  return adjacent;
}
