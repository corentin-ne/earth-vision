/**
 * ============================================================================
 * turfService.ts — Turf.js Facade for Complex Geospatial Operations
 * ============================================================================
 *
 * Wraps Turf.js operations behind a clean interface so components and
 * store slices never import Turf directly. This enables:
 *
 *   1. Easy mocking in tests.
 *   2. Lazy-loading Turf modules on demand (it's a large library).
 *   3. Centralized error handling for malformed geometries.
 *
 * All functions accept plain coordinate arrays matching our Ring / bbox types
 * and return plain data — no Turf Feature objects leak into the app layer.
 */

import type { Ring } from '../../types';

/** Cast readonly Ring[] to the mutable arrays Turf.js expects. */
function toCoords(rings: ReadonlyArray<Ring>): number[][][] {
  return rings as unknown as number[][][];
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SplitResult {
  /** The two halves of the split polygon. */
  parts: [Ring[], Ring[]];
}

export interface FuseResult {
  /** The merged polygon rings. */
  rings: Ring[];
}

export interface IntersectionResult {
  /** Whether the two polygons overlap. */
  intersects: boolean;
  /** The overlapping area, if any. */
  area: Ring[] | null;
}

// ─── Centroid ───────────────────────────────────────────────────────────────

/**
 * Compute the geographic centroid of a polygon.
 *
 * @param rings  Polygon rings (exterior + holes).
 * @returns      [longitude, latitude] of the centroid.
 */
export async function computeCentroid(
  rings: ReadonlyArray<Ring>,
): Promise<[lon: number, lat: number]> {
  const [{ polygon }, { default: centroid }] = await Promise.all([
    import('@turf/helpers'),
    import('@turf/centroid'),
  ]);
  const poly = polygon(toCoords(rings));
  const c = centroid(poly);
  const coords = c.geometry.coordinates;
  const lon = coords[0] ?? 0;
  const lat = coords[1] ?? 0;
  return [lon, lat];
}

// ─── Area ───────────────────────────────────────────────────────────────────

/**
 * Compute the geodesic area of a polygon in square kilometers.
 *
 * @param rings  Polygon rings (exterior + holes).
 * @returns      Area in km².
 */
export async function computeArea(
  rings: ReadonlyArray<Ring>,
): Promise<number> {
  const [{ polygon }, { default: area }] = await Promise.all([
    import('@turf/helpers'),
    import('@turf/area'),
  ]);
  const poly = polygon(toCoords(rings));
  return area(poly) / 1_000_000; // m² → km²
}

// ─── Bounding Box ───────────────────────────────────────────────────────────

/**
 * Compute the bounding box of a set of polygon rings.
 *
 * @param rings  Polygon rings.
 * @returns      [west, south, east, north] in degrees.
 */
export async function computeBbox(
  rings: ReadonlyArray<Ring>,
): Promise<[west: number, south: number, east: number, north: number]> {
  const [{ polygon }, { default: bbox }] = await Promise.all([
    import('@turf/helpers'),
    import('@turf/bbox'),
  ]);
  const poly = polygon(toCoords(rings));
  const box = bbox(poly);
  return [box[0], box[1], box[2], box[3]];
}

// ─── Combined Bounding Box ─────────────────────────────────────────────────

/**
 * Compute a single bounding box encompassing multiple regions' bboxes.
 * Used to frame a country (union of all its regions) in the camera.
 *
 * @param bboxes  Array of [west, south, east, north] bounding boxes.
 * @returns       Combined [west, south, east, north].
 */
export function combineBboxes(
  bboxes: ReadonlyArray<Readonly<[number, number, number, number]>>,
): [west: number, south: number, east: number, north: number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const [w, s, e, n] of bboxes) {
    if (w < west) west = w;
    if (s < south) south = s;
    if (e > east) east = e;
    if (n > north) north = n;
  }

  return [west, south, east, north];
}

// ─── Point in Polygon ───────────────────────────────────────────────────────

/**
 * Test if a geographic point lies inside a polygon.
 *
 * @param lon    Longitude.
 * @param lat    Latitude.
 * @param rings  Polygon rings.
 * @returns      True if the point is inside.
 */
export async function isPointInPolygon(
  lon: number,
  lat: number,
  rings: ReadonlyArray<Ring>,
): Promise<boolean> {
  const [{ point, polygon }, { default: booleanPointInPolygon }] = await Promise.all([
    import('@turf/helpers'),
    import('@turf/boolean-point-in-polygon' as string),
  ]);
  const pt = point([lon, lat]);
  const poly = polygon(toCoords(rings));
  return booleanPointInPolygon(pt, poly);
}

// ─── Buffer ─────────────────────────────────────────────────────────────────

/**
 * Create a buffer zone around a polygon.
 *
 * @param rings     Polygon rings.
 * @param radiusKm  Buffer radius in kilometers.
 * @returns         Buffered polygon rings.
 */
export async function bufferPolygon(
  rings: ReadonlyArray<Ring>,
  radiusKm: number,
): Promise<Ring[]> {
  const [{ polygon }, { default: buffer }] = await Promise.all([
    import('@turf/helpers'),
    import('@turf/buffer'),
  ]);
  const poly = polygon(toCoords(rings));
  const buffered = buffer(poly, radiusKm, { units: 'kilometers' });
  if (!buffered) return [...rings] as Ring[];
  return buffered.geometry.coordinates as unknown as Ring[];
}

// ─── Simplify ───────────────────────────────────────────────────────────────

/**
 * Simplify a polygon to reduce vertex count while preserving shape.
 * Useful for LOD (Level of Detail) at different zoom levels.
 *
 * @param rings      Polygon rings.
 * @param tolerance  Simplification tolerance in degrees. Higher = coarser.
 * @returns          Simplified polygon rings.
 */
export async function simplifyPolygon(
  rings: ReadonlyArray<Ring>,
  tolerance: number = 0.01,
): Promise<Ring[]> {
  const [{ polygon }, { default: simplify }] = await Promise.all([
    import('@turf/helpers'),
    import('@turf/simplify'),
  ]);
  const poly = polygon(toCoords(rings));
  const simplified = simplify(poly, {
    tolerance,
    highQuality: true,
  });
  return simplified.geometry.coordinates as unknown as Ring[];
}
