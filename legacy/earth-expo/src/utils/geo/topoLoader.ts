/**
 * ============================================================================
 * topoLoader.ts — TopoJSON → RegionGeometry[] Parser
 * ============================================================================
 *
 * Parses a TopoJSON topology into the normalized `RegionGeometry` records
 * used by the rest of the application.
 *
 * Dependencies:
 *   - `topojson-client` — for `feature()` to convert arcs into GeoJSON.
 *
 * Design Goals:
 *   1. Single-pass: parse once at startup, produce an immutable
 *      `Record<RegionId, RegionGeometry>` for the store.
 *   2. Pre-compute centroids and bboxes so downstream consumers
 *      never touch raw coordinates.
 *   3. Remain synchronous — the bundled TopoJSON file is small enough
 *      (~600KB) that parsing completes in <100ms on modern devices.
 */

import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson';

import type { RegionId, RegionGeometry, Ring } from '../../types';
import { regionId } from '../../types';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Name of the object layer within the TopoJSON topology to extract. */
export type TopoLayerName = string;

/** Options for customizing the parsing behavior. */
export interface TopoLoaderOptions {
  /**
   * The key within `topology.objects` to extract features from.
   * Defaults to the first available key if not specified.
   */
  layerName?: TopoLayerName;

  /**
   * Property name on each feature used as the region ID.
   * Typical values: 'ISO_A2', 'ADM0_A3', 'name', 'id'.
   * Defaults to 'ISO_A2'.
   */
  idProperty?: string;

  /**
   * Minimum area in square degrees to include a region.
   * Tiny islands below this threshold are filtered out to
   * reduce draw calls. Defaults to 0 (include everything).
   */
  minAreaDeg2?: number;
}

// ─── Geometry Helpers ───────────────────────────────────────────────────────

/**
 * Approximate area of a polygon in square degrees using the Shoelace formula.
 * Only uses the exterior ring; holes are subtracted.
 */
function polygonAreaDeg2(rings: Position[][]): number {
  let area = ringArea(rings[0]);
  for (let i = 1; i < rings.length; i++) {
    area -= ringArea(rings[i]);
  }
  return Math.abs(area);
}

function ringArea(ring: Position[]): number {
  let sum = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += ring[i][0] * ring[j][1];
    sum -= ring[j][0] * ring[i][1];
  }
  return Math.abs(sum) / 2;
}

/**
 * Compute the centroid of a polygon as the area-weighted average
 * of its exterior ring vertices.
 */
function computeCentroid(rings: Position[][]): [lon: number, lat: number] {
  const ring = rings[0]; // exterior ring
  let cx = 0;
  let cy = 0;
  let area = 0;

  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
    cx += (ring[i][0] + ring[j][0]) * cross;
    cy += (ring[i][1] + ring[j][1]) * cross;
    area += cross;
  }

  area /= 2;
  if (Math.abs(area) < 1e-10) {
    // Degenerate polygon — fall back to arithmetic mean
    let sx = 0;
    let sy = 0;
    for (const pt of ring) {
      sx += pt[0];
      sy += pt[1];
    }
    return [sx / ring.length, sy / ring.length];
  }

  const factor = 1 / (6 * area);
  return [cx * factor, cy * factor];
}

/**
 * Compute the bounding box of a set of rings.
 */
function computeBbox(
  allRings: Position[][][],
): [west: number, south: number, east: number, north: number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const rings of allRings) {
    for (const ring of rings) {
      for (const coord of ring) {
        if (coord[0] < west) west = coord[0];
        if (coord[0] > east) east = coord[0];
        if (coord[1] < south) south = coord[1];
        if (coord[1] > north) north = coord[1];
      }
    }
  }

  return [west, south, east, north];
}

/**
 * Very rough area estimate in km² from area in square degrees.
 * Uses cos(midLat) correction for longitude scaling.
 */
function areaDeg2ToKm2(
  areaDeg2: number,
  midLat: number,
): number {
  const KM_PER_DEG_LAT = 111.32;
  const KM_PER_DEG_LON = 111.32 * Math.cos((midLat * Math.PI) / 180);
  return areaDeg2 * KM_PER_DEG_LAT * KM_PER_DEG_LON;
}

// ─── Main Parser ────────────────────────────────────────────────────────────

/**
 * Parse a TopoJSON topology into an array of `RegionGeometry` records.
 *
 * @param topology     Raw TopoJSON topology object (parsed from JSON).
 * @param options      Customization options.
 * @returns            Record keyed by RegionId for O(1) store hydration.
 *
 * @example
 * ```ts
 * import worldTopo from '../../data/world.topo.json';
 * const geometries = parseTopoJSON(worldTopo as unknown as Topology);
 * store.loadGeometries(geometries);
 * ```
 */
export function parseTopoJSON(
  topology: Topology,
  options: TopoLoaderOptions = {},
): Record<RegionId, RegionGeometry> {
  const {
    idProperty = 'ISO_A2',
    minAreaDeg2 = 0,
  } = options;

  // Resolve the layer name
  const objectKeys = Object.keys(topology.objects);
  if (objectKeys.length === 0) {
    throw new Error('[topoLoader] Topology contains no object layers.');
  }

  const layerName = options.layerName ?? objectKeys[0];
  const geometryCollection = topology.objects[layerName];

  if (!geometryCollection) {
    throw new Error(
      `[topoLoader] Layer "${layerName}" not found. Available: ${objectKeys.join(', ')}`,
    );
  }

  // Convert TopoJSON → GeoJSON FeatureCollection
  const fc = feature(
    topology,
    geometryCollection as GeometryCollection,
  ) as FeatureCollection<Polygon | MultiPolygon>;

  const result: Record<RegionId, RegionGeometry> = {};

  for (const feat of fc.features) {
    const props = feat.properties ?? {};
    const rawId = props[idProperty] ?? feat.id ?? `unknown-${Math.random().toString(36).slice(2)}`;
    const id = regionId(String(rawId));

    const geom = feat.geometry;
    if (!geom) continue;

    // Normalize Polygon / MultiPolygon to a uniform representation
    let polygonsCoords: Position[][][];
    if (geom.type === 'Polygon') {
      polygonsCoords = [geom.coordinates];
    } else if (geom.type === 'MultiPolygon') {
      polygonsCoords = geom.coordinates;
    } else {
      continue; // skip non-polygon geometries
    }

    // Area filter
    let totalAreaDeg2 = 0;
    for (const rings of polygonsCoords) {
      totalAreaDeg2 += polygonAreaDeg2(rings);
    }
    if (totalAreaDeg2 < minAreaDeg2) continue;

    // Compute derived properties
    const bbox = computeBbox(polygonsCoords);
    const midLat = (bbox[1] + bbox[3]) / 2;

    // Pick the largest polygon for centroid calculation
    let largestRings = polygonsCoords[0];
    let largestArea = 0;
    for (const rings of polygonsCoords) {
      const a = polygonAreaDeg2(rings);
      if (a > largestArea) {
        largestArea = a;
        largestRings = rings;
      }
    }
    const centroid = computeCentroid(largestRings);

    // Convert coordinates to Ring format (drop altitude if present)
    const rings: Ring[] = [];
    for (const polyRings of polygonsCoords) {
      for (const ring of polyRings) {
        rings.push(ring.map((coord) => [coord[0], coord[1]] as [number, number]));
      }
    }

    result[id] = {
      id,
      rings,
      centroid,
      bbox,
      areaKm2: areaDeg2ToKm2(totalAreaDeg2, midLat),
    };
  }

  return result;
}

// ─── Region Metadata Initializer ────────────────────────────────────────────

/**
 * Generate default `RegionMeta` records for all loaded geometries.
 * Called once at startup to populate the mutable layer.
 */
export function createDefaultRegionMetas(
  geometries: Record<RegionId, RegionGeometry>,
): Record<RegionId, import('../../types').RegionMeta> {
  const result: Record<RegionId, import('../../types').RegionMeta> = {};

  for (const [id, geom] of Object.entries(geometries)) {
    result[id as RegionId] = {
      id: geom.id,
      label: null,
      colorOverride: null,
      elevation: 1.0,
      customData: {},
    };
  }

  return result;
}
