/**
 * ============================================================================
 * geoManipulation.ts — Geospatial Manipulation Engine
 * ============================================================================
 *
 * Core engine for polygon boolean operations: FUSE (union) and SPLIT
 * (difference). This is the heart of the "edit geography" feature.
 *
 * ─── NON-BLOCKING ARCHITECTURE ─────────────────────────────────────────────
 *
 * Turf.js boolean operations (union, difference, lineToPolygon) can take
 * 50-200ms on complex coastlines — enough to drop frames on mobile.
 *
 * Every function in this module is `async` and lazily imports Turf modules.
 * This achieves two goals:
 *   1. **Tree-shaking**: Only the Turf submodules actually used are bundled.
 *   2. **Web Worker readiness**: Because every entry point returns a Promise,
 *      the caller can trivially swap `import('./geoManipulation')` for a
 *      Comlink/workerize proxy without changing any call sites.
 *
 * Future optimization: Move this entire module into a dedicated Web Worker
 * via `expo-worker` or `react-native-threads` and expose it through Comlink.
 *
 * ─── COORDINATE CONVENTION ─────────────────────────────────────────────────
 *
 * All coordinates follow GeoJSON [longitude, latitude] ordering.
 * Turf.js also uses [lon, lat]. Our internal `Ring` type matches this.
 *
 * ─── ERROR HANDLING ────────────────────────────────────────────────────────
 *
 * Turf operations can fail on degenerate polygons (self-intersecting,
 * zero-area slivers, etc.). Every function wraps Turf calls in try/catch
 * and returns a discriminated union result type for safe consumption.
 */

import type { Ring, RegionId, RegionGeometry } from '../../types';
import { regionId } from '../../types';

// ─── Result Types ──────────────────────────────────────────────────────────
// Discriminated unions so callers can pattern-match on success/failure
// without throwing exceptions through the UI layer.

export interface FuseSuccess {
  ok: true;
  /** The merged polygon rings (exterior + any holes). */
  rings: Ring[];
  /** Pre-computed centroid [lon, lat] of the fused polygon. */
  centroid: [lon: number, lat: number];
  /** Pre-computed bbox [west, south, east, north]. */
  bbox: [west: number, south: number, east: number, north: number];
  /** Pre-computed area in km². */
  areaKm2: number;
}

export interface FuseError {
  ok: false;
  /** Human-readable error message for toast/UI display. */
  reason: string;
}

export type FuseResult = FuseSuccess | FuseError;

export interface SplitSuccess {
  ok: true;
  /**
   * The resulting polygon parts after the split.
   * Typically 2 parts, but complex cuts can produce more (e.g. cutting
   * through an archipelago). Each part includes its own rings, centroid,
   * bbox, and area.
   */
  parts: Array<{
    rings: Ring[];
    centroid: [lon: number, lat: number];
    bbox: [west: number, south: number, east: number, north: number];
    areaKm2: number;
  }>;
}

export interface SplitError {
  ok: false;
  reason: string;
}

export type SplitResult = SplitSuccess | SplitError;

// ─── Internal Helpers ──────────────────────────────────────────────────────

/**
 * Cast our readonly Ring[] to the mutable number[][][] that Turf expects.
 * This is safe because Turf does not mutate its inputs.
 */
function ringsToCoords(rings: ReadonlyArray<Ring>): number[][][] {
  return rings as unknown as number[][][];
}

/**
 * Extract Ring[] from a Turf geometry's coordinates, handling both
 * Polygon and MultiPolygon results from boolean operations.
 *
 * turf.union can return either a Polygon or a MultiPolygon depending
 * on whether the inputs share a border or are disjoint.
 */
function extractRings(
  geometry: GeoJSON.Geometry,
): Ring[][] {
  if (geometry.type === 'Polygon') {
    // Single polygon → one set of rings (exterior + holes)
    return [geometry.coordinates as unknown as Ring[]];
  }
  if (geometry.type === 'MultiPolygon') {
    // Multiple disjoint polygons → each gets its own ring set
    return (geometry.coordinates as unknown as Ring[][][]).map(
      (polygonCoords) => polygonCoords as Ring[],
    );
  }
  // Unexpected geometry type (point, line) — shouldn't happen with union/diff
  return [];
}

/**
 * Flatten all rings from potentially multiple polygons into a single
 * Ring[] array. Used when the fuse result must be stored as a single
 * RegionGeometry (which expects one Ring[]).
 *
 * For MultiPolygon results: we store all polygon exteriors + holes
 * as separate rings. The triangulator already handles this correctly.
 */
function flattenRingGroups(groups: Ring[][]): Ring[] {
  const result: Ring[] = [];
  for (const group of groups) {
    for (const ring of group) {
      result.push(ring);
    }
  }
  return result;
}

// ─── FUSE (Union) ──────────────────────────────────────────────────────────

/**
 * Fuse two geographic regions into a single merged polygon.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  ALGORITHM                                                          │
 * │                                                                     │
 * │  1. Validate: Both regions must have valid geometry with rings.      │
 * │  2. Convert Ring[] → Turf Polygon features.                         │
 * │  3. Execute turf.union(polygonA, polygonB).                         │
 * │     • If the polygons share a border → result is a Polygon.         │
 * │     • If they are disjoint → result is a MultiPolygon.              │
 * │  4. Extract the result's coordinates back into our Ring[] format.   │
 * │  5. Compute centroid, bbox, and area for the merged polygon.        │
 * │  6. Return a FuseSuccess with all derived geometry data.            │
 * │                                                                     │
 * │  EDGE CASES                                                         │
 * │  • Self-intersecting polygons → Turf may throw; caught & reported.  │
 * │  • Disjoint regions → valid MultiPolygon returned (both kept).      │
 * │  • Identical regions → result equals input (degenerate but safe).   │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * @param regionA  First region's immutable geometry.
 * @param regionB  Second region's immutable geometry.
 * @returns        FuseResult — either { ok: true, rings, centroid, bbox, areaKm2 }
 *                 or { ok: false, reason }.
 *
 * @example
 * ```ts
 * const result = await fuseRegions(geometries['US-CA'], geometries['US-NV']);
 * if (result.ok) {
 *   // result.rings contains the merged polygon
 *   // result.centroid is [lon, lat] of the combined shape
 *   store.getState().completeFuse('US-CA', 'US-NV', result);
 * }
 * ```
 */
export async function fuseRegions(
  regionA: RegionGeometry,
  regionB: RegionGeometry,
): Promise<FuseResult> {
  // ── Step 1: Validate inputs ──────────────────────────────────────────
  // Both regions must have at least one ring (the exterior polygon).
  // A region with zero rings is malformed and cannot be fused.
  if (!regionA.rings.length || !regionB.rings.length) {
    return {
      ok: false,
      reason: 'One or both regions have no polygon data to fuse.',
    };
  }

  try {
    // ── Step 2: Lazy-load only the Turf modules we need ────────────────
    // This keeps the initial bundle small. Each import() is cached by
    // the bundler after the first call, so subsequent fuses are instant.
    const [
      { default: turfUnion },
      { default: turfCentroid },
      { default: turfBbox },
      { default: turfArea },
    ] = await Promise.all([
      import('@turf/union'),
      import('@turf/centroid'),
      import('@turf/bbox'),
      import('@turf/area'),
    ]);

    // ── Step 3: Build Turf Polygon features from our Ring arrays ───────
    //
    // Turf expects GeoJSON Feature<Polygon> objects. Our Ring[] maps
    // directly to the Polygon coordinate structure:
    //   Ring[] → [ exteriorRing, ...holeRings ]
    //
    // We use `turf.polygon()` from the helpers submodule for construction.
    const { polygon: turfPolygon } = await import('@turf/helpers');

    const polyA = turfPolygon(ringsToCoords(regionA.rings));
    const polyB = turfPolygon(ringsToCoords(regionB.rings));

    // ── Step 4: Execute the boolean union ──────────────────────────────
    //
    // turf.union computes the geometric union of two polygons using the
    // Greiner-Hormann clipping algorithm (via martinez-polygon-clipping).
    //
    // Possible results:
    //   • Polygon       — the two inputs share a boundary (most common).
    //   • MultiPolygon  — the inputs are disjoint (both shapes preserved).
    //   • null           — shouldn't happen with valid polygons.
    const unionResult = turfUnion(
      // @ts-expect-error — Turf's overloaded types can be finicky with
      // generic Feature vs Feature<Polygon>. Runtime behavior is correct.
      polyA,
      polyB,
    );

    if (!unionResult || !unionResult.geometry) {
      return {
        ok: false,
        reason: 'Turf.js union returned no geometry. The polygons may be degenerate.',
      };
    }

    // ── Step 5: Extract coordinates back to Ring[] format ──────────────
    const ringGroups = extractRings(unionResult.geometry);
    if (ringGroups.length === 0) {
      return {
        ok: false,
        reason: 'Union produced an empty or unsupported geometry type.',
      };
    }

    // Flatten all polygon groups into a single Ring[] for storage.
    // Our triangulator handles multiple exterior rings correctly.
    const mergedRings = flattenRingGroups(ringGroups);

    // ── Step 6: Compute derived geometry properties ────────────────────
    // These are needed to populate the new RegionGeometry entry.

    // Centroid: geographic center of the merged shape
    const centroidFeature = turfCentroid(unionResult);
    const [lon, lat] = centroidFeature.geometry.coordinates;

    // Bounding box: [west, south, east, north]
    const bboxRaw = turfBbox(unionResult);
    const bbox: [number, number, number, number] = [
      bboxRaw[0], bboxRaw[1], bboxRaw[2], bboxRaw[3],
    ];

    // Area: geodesic area in km²
    const areaM2 = turfArea(unionResult);
    const areaKm2 = areaM2 / 1_000_000;

    // ── Step 7: Return success result ──────────────────────────────────
    return {
      ok: true,
      rings: mergedRings,
      centroid: [lon, lat],
      bbox,
      areaKm2,
    };
  } catch (error) {
    // ── Error recovery ─────────────────────────────────────────────────
    // Turf can throw on self-intersecting polygons, degenerate rings,
    // or NaN coordinates. We catch everything and return a user-friendly
    // error message rather than crashing the app.
    const message =
      error instanceof Error ? error.message : 'Unknown Turf.js error';
    return {
      ok: false,
      reason: `Fuse operation failed: ${message}`,
    };
  }
}

// ─── SPLIT (Difference with a cutting line) ────────────────────────────────

/**
 * Split a geographic region into two or more parts using a cutting line.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  ALGORITHM — 2D Screen Swipe → 3D Geospatial Split                 │
 * │                                                                     │
 * │  Step 1: RECEIVE THE CUTTING LINE                                   │
 * │    The input `cuttingLine` is an array of [lon, lat] points that    │
 * │    has already been projected from screen space onto the sphere     │
 * │    surface (see screenToGeoLine in projection utilities).           │
 * │                                                                     │
 * │  Step 2: BUFFER THE LINE INTO A THIN POLYGON                       │
 * │    A bare LineString cannot be used with turf.difference (which     │
 * │    requires polygon inputs). We buffer the line by a small amount   │
 * │    (default ~1km) to create a thin "blade" polygon.                 │
 * │                                                                     │
 * │  Step 3: CUT WITH turf.difference                                  │
 * │    turf.difference(regionPolygon, bladePolygon) removes the blade   │
 * │    from the region. If the blade fully bisects the region, the      │
 * │    result is a MultiPolygon with two (or more) parts.               │
 * │                                                                     │
 * │  Step 4: EXTRACT & VALIDATE PARTS                                  │
 * │    Each resulting polygon becomes a new region. We compute its      │
 * │    centroid, bbox, and area. Parts below a minimum area threshold   │
 * │    are discarded as slivers.                                        │
 * │                                                                     │
 * │  Step 5: RETURN PARTS                                               │
 * │    The caller (store action) will create new RegionGeometry entries │
 * │    for each part and delete the original.                           │
 * │                                                                     │
 * │  EDGE CASES                                                         │
 * │  • Line doesn't fully cross the region → only 1 part (no split).   │
 * │  • Line produces tiny slivers → filtered out by minAreaKm2.        │
 * │  • Line crosses multiple times → may produce 3+ parts (valid).     │
 * │  • Region is a MultiPolygon (archipelago) → each island tested.    │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * @param region       The region to split.
 * @param cuttingLine  Array of [lon, lat] points defining the cut.
 *                     Must have at least 2 points. Should extend beyond
 *                     the region's boundary on both sides for a clean cut.
 * @param bufferKm     Width of the cutting blade in km. Default 1.0.
 *                     Larger values create a wider gap between parts.
 * @param minAreaKm2   Minimum area for a split part to be kept. Default 100.
 *                     Smaller slivers are discarded.
 * @returns            SplitResult — success with parts[] or failure with reason.
 *
 * @example
 * ```ts
 * // cuttingLine from the useDrawLine hook (already in geo coords)
 * const result = await splitRegion(
 *   geometries['US-CA'],
 *   [[−122, 36], [−118, 36]],  // horizontal cut across California
 * );
 * if (result.ok && result.parts.length >= 2) {
 *   store.getState().completeSplit('US-CA', result.parts);
 * }
 * ```
 */
export async function splitRegion(
  region: RegionGeometry,
  cuttingLine: [lon: number, lat: number][],
  bufferKm: number = 1.0,
  minAreaKm2: number = 100,
): Promise<SplitResult> {
  // ── Validate inputs ──────────────────────────────────────────────────
  if (!region.rings.length) {
    return { ok: false, reason: 'Region has no polygon data to split.' };
  }

  if (cuttingLine.length < 2) {
    return {
      ok: false,
      reason: 'Cutting line must have at least 2 points.',
    };
  }

  try {
    // ── Lazy-load Turf modules ─────────────────────────────────────────
    const [
      { default: turfDifference },
      { default: turfBuffer },
      { default: turfCentroid },
      { default: turfBbox },
      { default: turfArea },
      { default: turfBooleanIntersects },
    ] = await Promise.all([
      import('@turf/difference'),
      import('@turf/buffer'),
      import('@turf/centroid'),
      import('@turf/bbox'),
      import('@turf/area'),
      import('@turf/boolean-intersects'),
    ]);

    const { polygon: turfPolygon, lineString: turfLineString } =
      await import('@turf/helpers');

    // ── Build the region polygon ───────────────────────────────────────
    const regionPoly = turfPolygon(ringsToCoords(region.rings));

    // ── Build the cutting line ─────────────────────────────────────────
    const line = turfLineString(cuttingLine as number[][]);

    // ── Verify the line actually intersects the region ─────────────────
    // If the user drew a line that doesn't cross the region at all,
    // we short-circuit with a meaningful error.
    const intersects = turfBooleanIntersects(line, regionPoly);
    if (!intersects) {
      return {
        ok: false,
        reason:
          'The cutting line does not intersect the region. ' +
          'Draw a line that crosses the region boundary on both sides.',
      };
    }

    // ── Buffer the line into a thin "blade" polygon ────────────────────
    //
    // Why buffer? turf.difference requires Polygon vs Polygon inputs.
    // A LineString has zero area, so we inflate it into a thin strip.
    //
    // The bufferKm parameter controls the "gap" width between the two
    // resulting halves. 1km is nearly invisible on a world map but
    // ensures clean topology with no zero-width cracks.
    const blade = turfBuffer(line, bufferKm, { units: 'kilometers' });

    if (!blade || !blade.geometry) {
      return {
        ok: false,
        reason: 'Failed to create cutting blade from the drawn line.',
      };
    }

    // ── Perform the boolean difference ─────────────────────────────────
    //
    // turf.difference(A, B) = A \ B  (remove B from A)
    //
    // If the blade fully bisects region A, the result is a MultiPolygon
    // containing two (or more) disjoint parts. If the blade only clips
    // an edge, the result is a single Polygon (no split occurred).
    const diffResult = turfDifference(
      // @ts-expect-error — Turf type overloads
      regionPoly,
      blade,
    );

    if (!diffResult || !diffResult.geometry) {
      return {
        ok: false,
        reason:
          'Difference operation returned no geometry. ' +
          'The cutting line may have consumed the entire region.',
      };
    }

    // ── Extract the resulting polygon parts ────────────────────────────
    const ringGroups = extractRings(diffResult.geometry);

    if (ringGroups.length < 2) {
      // The line didn't fully bisect — only one piece remains.
      // This isn't an error, but the user didn't achieve a split.
      return {
        ok: false,
        reason:
          'The line did not fully bisect the region. ' +
          'Ensure the cut line extends beyond the region on both sides.',
      };
    }

    // ── Compute properties for each part and filter slivers ────────────
    const parts: SplitSuccess['parts'] = [];

    for (const ringGroup of ringGroups) {
      // Build a temporary polygon feature for this part
      const partPoly = turfPolygon(ringGroup as unknown as number[][][]);

      // Compute area
      const areaM2 = turfArea(partPoly);
      const areaKm2 = areaM2 / 1_000_000;

      // Filter out tiny slivers created by imprecise cutting
      if (areaKm2 < minAreaKm2) {
        continue;
      }

      // Compute centroid
      const centroidFeature = turfCentroid(partPoly);
      const [lon, lat] = centroidFeature.geometry.coordinates;

      // Compute bbox
      const bboxRaw = turfBbox(partPoly);
      const bbox: [number, number, number, number] = [
        bboxRaw[0], bboxRaw[1], bboxRaw[2], bboxRaw[3],
      ];

      parts.push({
        rings: ringGroup,
        centroid: [lon, lat],
        bbox,
        areaKm2,
      });
    }

    // ── Validate we got at least 2 meaningful parts ────────────────────
    if (parts.length < 2) {
      return {
        ok: false,
        reason:
          'Split produced fewer than 2 meaningful parts. ' +
          'The cut may have created only slivers. Try a different line.',
      };
    }

    return { ok: true, parts };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown Turf.js error';
    return {
      ok: false,
      reason: `Split operation failed: ${message}`,
    };
  }
}

// ─── ADJACENCY CHECK (for fuse validation) ─────────────────────────────────

/**
 * Check if two regions are geographically adjacent using precise Turf.js
 * topology checks. More accurate than the fast heuristic in regionOps.ts.
 *
 * Used to validate that the user is fusing two regions that actually share
 * a border, not two random disconnected regions.
 *
 * @param regionA  First region.
 * @param regionB  Second region.
 * @returns        True if the regions share a border or overlap.
 */
export async function areRegionsTouching(
  regionA: RegionGeometry,
  regionB: RegionGeometry,
): Promise<boolean> {
  try {
    const [
      { default: turfBooleanIntersects },
    ] = await Promise.all([
      import('@turf/boolean-intersects'),
    ]);

    const { polygon: turfPolygon } = await import('@turf/helpers');

    const polyA = turfPolygon(ringsToCoords(regionA.rings));
    const polyB = turfPolygon(ringsToCoords(regionB.rings));

    return turfBooleanIntersects(polyA, polyB);
  } catch {
    // Fall back to bbox overlap check
    const [aw, as_, ae, an] = regionA.bbox;
    const [bw, bs, be, bn] = regionB.bbox;
    return !(ae < bw || be < aw || an < bs || bn < as_);
  }
}

// ─── GENERATE NEW REGION ID ────────────────────────────────────────────────

/**
 * Generate a new unique RegionId for a split-created region.
 *
 * Convention: `{parentId}-{suffix}` where suffix is a, b, c, ...
 * This preserves traceability — you can always see which original
 * region a split part came from.
 *
 * @param parentId  The original region's ID.
 * @param index     Zero-based index of the part (0→'a', 1→'b', etc.).
 * @returns         New branded RegionId.
 */
export function generateSplitRegionId(
  parentId: RegionId,
  index: number,
): RegionId {
  const suffix = String.fromCharCode(97 + index); // 97 = 'a'
  return regionId(`${parentId}-${suffix}`);
}
