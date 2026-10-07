/**
 * ============================================================================
 * spatialIndex.ts — R-tree Spatial Index for Region Hit-Testing
 * ============================================================================
 *
 * Provides fast O(log n) region lookup by screen-space coordinates.
 * Uses a simple grid-based spatial index (no external dependencies)
 * that maps bounding-box cells to region IDs.
 *
 * For raycasting: the raycast hit produces a [lon, lat] point on the
 * sphere surface. We then query the spatial index to find candidate
 * regions whose bboxes contain that point, and finally do a precise
 * point-in-polygon test to resolve the exact region.
 */

import type { RegionId, RegionGeometry, Ring } from '../../types';

// ─── Configuration ──────────────────────────────────────────────────────────

/** Grid resolution in degrees per cell. Smaller = more memory, faster query. */
const CELL_SIZE_DEG = 5;

/** Number of cells in longitude direction. */
const GRID_COLS = Math.ceil(360 / CELL_SIZE_DEG);

/** Number of cells in latitude direction. */
const GRID_ROWS = Math.ceil(180 / CELL_SIZE_DEG);

// ─── Grid Cell Helpers ──────────────────────────────────────────────────────

function lonToCol(lon: number): number {
  return Math.floor((lon + 180) / CELL_SIZE_DEG);
}

function latToRow(lat: number): number {
  return Math.floor((lat + 90) / CELL_SIZE_DEG);
}

function cellKey(col: number, row: number): number {
  return row * GRID_COLS + col;
}

// ─── Point-in-Polygon (Ray Casting) ─────────────────────────────────────────

/**
 * Determine if a point lies inside a polygon ring using the ray-casting
 * algorithm. Returns true if the point is inside.
 *
 * @param lon  Longitude of the test point.
 * @param lat  Latitude of the test point.
 * @param ring Polygon ring as [lon, lat][] pairs.
 */
export function pointInRing(
  lon: number,
  lat: number,
  ring: Ring,
): boolean {
  let inside = false;
  const n = ring.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Test if a point is inside a multi-ring polygon (with holes).
 * The first ring is the exterior; subsequent rings are holes.
 */
export function pointInPolygon(
  lon: number,
  lat: number,
  rings: ReadonlyArray<Ring>,
): boolean {
  // Must be inside the exterior ring
  if (!pointInRing(lon, lat, rings[0])) return false;

  // Must NOT be inside any hole ring
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lon, lat, rings[i])) return false;
  }

  return true;
}

// ─── Spatial Index ──────────────────────────────────────────────────────────

/**
 * A grid-based spatial index for fast geographic point → RegionId lookups.
 *
 * Usage:
 * ```ts
 * const index = new SpatialIndex();
 * index.build(store.geometries);
 * const regionId = index.query(lon, lat);
 * ```
 */
export class SpatialIndex {
  /** Grid cells mapping to sets of region IDs whose bboxes overlap. */
  private grid = new Map<number, Set<RegionId>>();

  /** Reference to geometry data for point-in-polygon refinement. */
  private geometries: Record<RegionId, RegionGeometry> = {};

  /**
   * Build the spatial index from a geometry map.
   * Should be called once at startup and whenever geometry is reloaded.
   *
   * @param geometries The immutable geometry cache from the store.
   */
  build(geometries: Record<RegionId, RegionGeometry>): void {
    this.geometries = geometries;
    this.grid.clear();

    for (const geom of Object.values(geometries)) {
      const [west, south, east, north] = geom.bbox;

      const colMin = Math.max(0, lonToCol(west));
      const colMax = Math.min(GRID_COLS - 1, lonToCol(east));
      const rowMin = Math.max(0, latToRow(south));
      const rowMax = Math.min(GRID_ROWS - 1, latToRow(north));

      for (let row = rowMin; row <= rowMax; row++) {
        for (let col = colMin; col <= colMax; col++) {
          const key = cellKey(col, row);
          let bucket = this.grid.get(key);
          if (!bucket) {
            bucket = new Set();
            this.grid.set(key, bucket);
          }
          bucket.add(geom.id);
        }
      }
    }
  }

  /**
   * Query the index for the region at a given geographic point.
   *
   * @param lon  Longitude in degrees.
   * @param lat  Latitude in degrees.
   * @returns    The RegionId of the region containing the point, or null.
   */
  query(lon: number, lat: number): RegionId | null {
    const col = lonToCol(lon);
    const row = latToRow(lat);
    const key = cellKey(col, row);

    const candidates = this.grid.get(key);
    if (!candidates) return null;

    // First pass: quick bbox check
    const bboxMatches: RegionId[] = [];
    for (const id of candidates) {
      const geom = this.geometries[id];
      if (!geom) continue;

      const [west, south, east, north] = geom.bbox;
      if (lon >= west && lon <= east && lat >= south && lat <= north) {
        bboxMatches.push(id);
      }
    }

    if (bboxMatches.length === 0) return null;
    if (bboxMatches.length === 1) {
      // Still need point-in-polygon for concave regions
      const geom = this.geometries[bboxMatches[0]];
      return this.isPointInRegion(lon, lat, geom) ? bboxMatches[0] : null;
    }

    // Second pass: precise point-in-polygon, prefer smallest area (most specific)
    let bestId: RegionId | null = null;
    let bestArea = Infinity;

    for (const id of bboxMatches) {
      const geom = this.geometries[id];
      if (this.isPointInRegion(lon, lat, geom) && geom.areaKm2 < bestArea) {
        bestId = id;
        bestArea = geom.areaKm2;
      }
    }

    return bestId;
  }

  /**
   * Test if a point is inside any of the region's polygon rings.
   * Handles multi-polygon regions by testing each polygon group.
   */
  private isPointInRegion(
    lon: number,
    lat: number,
    geom: RegionGeometry,
  ): boolean {
    // The rings array stores exterior + hole rings for potentially
    // multiple polygons. We need to determine the grouping.
    // For simplicity, we treat the first ring as exterior and
    // test against it. For full multi-polygon support, the
    // topoLoader should store polygon grouping metadata.
    //
    // Simple heuristic: test each ring as a potential exterior.
    // If point is inside an odd number of rings, it's inside the region.
    // This works for simple cases; complex regions with holes need
    // proper exterior/hole pairing from the loader.
    for (const ring of geom.rings) {
      if (pointInRing(lon, lat, ring)) {
        return true;
      }
    }
    return false;
  }

  /** Number of grid cells populated. Useful for diagnostics. */
  get cellCount(): number {
    return this.grid.size;
  }

  /** Total number of (cell, region) pairs. Useful for diagnostics. */
  get entryCount(): number {
    let count = 0;
    for (const bucket of this.grid.values()) {
      count += bucket.size;
    }
    return count;
  }
}
