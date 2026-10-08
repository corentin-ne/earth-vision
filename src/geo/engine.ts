import { topology } from 'topojson-server';
import { merge } from 'topojson-client';
import type { GeometryCollection, MultiPolygon as TopoMultiPolygon, Polygon as TopoPolygon, Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, MultiLineString, MultiPolygon, Position } from 'geojson';
import polylabel from 'polylabel';
import type { LngLat, RegionGeom } from '../types';

type TopoRegion = (TopoPolygon | TopoMultiPolygon) & { id: number };

/** Arcs on the antimeridian or the south pole are cuts in the data, not real borders. */
function isSeam(arc: Position[]): boolean {
  let lng180 = true;
  let pole = true;
  for (const [x, y] of arc) {
    if (Math.abs(x) < 179.999) lng180 = false;
    if (y > -89.99) pole = false;
    if (!lng180 && !pole) return false;
  }
  return true;
}

export interface BorderLines {
  /** Between two different owners (or owner ↔ unclaimed). */
  countries: MultiLineString;
  /** Between two regions of the same owner. */
  regions: MultiLineString;
  /** Land ↔ sea. */
  coast: MultiLineString;
}

/**
 * Keeps the regions as a TopoJSON topology so that every border is stored once
 * as an arc shared by the (at most two) regions on either side. That makes the
 * expensive political operations cheap:
 *  - country borders = arcs whose two sides have different owners (no clipping),
 *  - country shapes  = arc-based merge of the owned regions,
 *  - neighbours      = regions sharing an arc.
 */
export class GeoEngine {
  private topo: Topology<{ regions: GeometryCollection }> | null = null;
  private byId = new Map<number, TopoRegion>();
  /** For every arc, the region ids on each side (-1 = none). */
  private arcSides = new Int32Array(0);
  private seams = new Uint8Array(0);
  version = 0;

  build(geoms: Record<number, RegionGeom>) {
    const features: Feature<RegionGeom>[] = [];
    for (const [id, g] of Object.entries(geoms)) {
      if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
        features.push({ type: 'Feature', id: Number(id), properties: null, geometry: g });
      }
    }
    // No quantization: arcs keep the exact input coordinates.
    const topo = topology({ regions: { type: 'FeatureCollection', features } as FeatureCollection }) as Topology<{
      regions: GeometryCollection;
    }>;
    this.topo = topo;
    this.byId.clear();
    const sides = new Int32Array(topo.arcs.length * 2).fill(-1);
    for (const g of topo.objects.regions.geometries as TopoRegion[]) {
      this.byId.set(g.id, g);
      const add = (a: number) => {
        const i = a < 0 ? ~a : a;
        if (sides[i * 2] === -1) sides[i * 2] = g.id;
        else if (sides[i * 2] !== g.id) sides[i * 2 + 1] = g.id;
      };
      if (g.type === 'Polygon') g.arcs.forEach((ring) => ring.forEach(add));
      else g.arcs.forEach((poly) => poly.forEach((ring) => ring.forEach(add)));
    }
    this.arcSides = sides;
    this.adjacency = null;
    this.seams = new Uint8Array(topo.arcs.length);
    topo.arcs.forEach((arc, i) => (this.seams[i] = isSeam(arc as Position[]) ? 1 : 0));
    this.version++;
  }

  get ready() {
    return this.topo !== null;
  }

  /** Classifies every arc by who owns each side. `owner` maps region id → country id. */
  borders(owner: (rid: number) => string): BorderLines {
    const countries: Position[][] = [];
    const regions: Position[][] = [];
    const coast: Position[][] = [];
    if (!this.topo) return { countries: ml(countries), regions: ml(regions), coast: ml(coast) };
    const arcs = this.topo.arcs as Position[][];
    const sides = this.arcSides;
    for (let i = 0; i < arcs.length; i++) {
      if (this.seams[i]) continue;
      const a = sides[i * 2];
      const b = sides[i * 2 + 1];
      if (b === -1) {
        coast.push(arcs[i]);
      } else {
        const oa = owner(a);
        const ob = owner(b);
        if (oa === ob) {
          regions.push(arcs[i]);
        } else {
          countries.push(arcs[i]);
        }
      }
    }
    return { countries: ml(countries), regions: ml(regions), coast: ml(coast) };
  }

  /** The outer boundary of a set of regions (for selection highlights). */
  outline(inSet: (rid: number) => boolean): MultiLineString {
    const out: Position[][] = [];
    if (!this.topo) return ml(out);
    const arcs = this.topo.arcs as Position[][];
    const sides = this.arcSides;
    for (let i = 0; i < arcs.length; i++) {
      if (this.seams[i]) continue;
      const a = sides[i * 2];
      const b = sides[i * 2 + 1];
      const ina = a !== -1 && inSet(a);
      const inb = b !== -1 && inSet(b);
      if (ina !== inb) out.push(arcs[i]);
    }
    return ml(out);
  }

  /** Union of regions, computed on shared arcs (exact and fast). */
  merge(ids: Iterable<number>): MultiPolygon | null {
    if (!this.topo) return null;
    const objs: TopoRegion[] = [];
    for (const id of ids) {
      const g = this.byId.get(id);
      if (g) objs.push(g);
    }
    if (!objs.length) return null;
    return merge(this.topo, objs) as MultiPolygon;
  }

  private adjacency: Map<number, number[]> | null = null;

  /** Region ids sharing at least one border arc with `rid`. */
  neighbors(rid: number): number[] {
    if (!this.adjacency) {
      // Built once per topology: flood fills ask for the neighbours of many regions.
      const sets = new Map<number, Set<number>>();
      const sides = this.arcSides;
      for (let i = 0; i < sides.length; i += 2) {
        const a = sides[i];
        const b = sides[i + 1];
        if (a === -1 || b === -1 || a === b) continue;
        (sets.get(a) ?? sets.set(a, new Set()).get(a)!).add(b);
        (sets.get(b) ?? sets.set(b, new Set()).get(b)!).add(a);
      }
      this.adjacency = new Map([...sets].map(([k, v]) => [k, [...v]]));
    }
    return this.adjacency.get(rid) ?? [];
  }

  /** A point in the middle of each border stretch regions a and b share. */
  sharedPoints(a: number, b: number): LngLat[] {
    const out: LngLat[] = [];
    if (!this.topo) return out;
    const sides = this.arcSides;
    const arcs = this.topo.arcs as Position[][];
    for (let i = 0; i < arcs.length; i++) {
      const x = sides[i * 2];
      const y = sides[i * 2 + 1];
      if (!((x === a && y === b) || (x === b && y === a))) continue;
      const arc = arcs[i];
      const k = arc.length >> 1;
      out.push(arc.length % 2 ? (arc[k] as LngLat) : [(arc[k - 1][0] + arc[k][0]) / 2, (arc[k - 1][1] + arc[k][1]) / 2]);
    }
    return out;
  }

  /** The border arcs with one side in `a` and the other in `b` (e.g. two countries' shared border). */
  arcsBetween(a: (rid: number) => boolean, b: (rid: number) => boolean): LngLat[][] {
    const out: LngLat[][] = [];
    if (!this.topo) return out;
    const sides = this.arcSides;
    const arcs = this.topo.arcs as Position[][];
    for (let i = 0; i < arcs.length; i++) {
      const x = sides[i * 2];
      const y = sides[i * 2 + 1];
      if (x === -1 || y === -1) continue;
      if ((a(x) && b(y)) || (a(y) && b(x))) out.push(arcs[i] as LngLat[]);
    }
    return out;
  }

  /** All regions bordering any region in the set (excluding the set itself). */
  neighborsOfSet(inSet: (rid: number) => boolean): Set<number> {
    const out = new Set<number>();
    const sides = this.arcSides;
    for (let i = 0; i < sides.length; i += 2) {
      const a = sides[i];
      const b = sides[i + 1];
      if (b === -1) continue;
      const ina = inSet(a);
      const inb = inSet(b);
      if (ina && !inb) out.add(b);
      else if (inb && !ina) out.add(a);
    }
    return out;
  }
}

function ml(coordinates: Position[][]): MultiLineString {
  return { type: 'MultiLineString', coordinates };
}

// ── Measurements ─────────────────────────────────────────────────────────────

const R = 6371.0088; // km

function ringArea(ring: Position[]): number {
  // Spherical excess approximation (same as d3/turf): area in km².
  let total = 0;
  const n = ring.length;
  if (n < 3) return 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    total += ((x2 - x1) * Math.PI) / 180 * (2 + Math.sin((y1 * Math.PI) / 180) + Math.sin((y2 * Math.PI) / 180));
  }
  return Math.abs((total * R * R) / 2);
}

export function geomArea(g: RegionGeom): number {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let a = 0;
  for (const p of polys) {
    a += ringArea(p[0]);
    for (let i = 1; i < p.length; i++) a -= ringArea(p[i]);
  }
  return Math.abs(a);
}

/** Best label anchor: the pole of inaccessibility of the largest polygon. */
export function labelPoint(g: RegionGeom | MultiPolygon | null): LngLat | null {
  if (!g) return null;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let best: Position[][] | null = null;
  let bestArea = -1;
  for (const p of polys) {
    const a = ringArea(p[0]);
    if (a > bestArea) {
      bestArea = a;
      best = p;
    }
  }
  if (!best) return null;
  // Work in a locally scaled space so high-latitude shapes aren't squashed.
  const lat0 = best[0].reduce((s, c) => s + c[1], 0) / best[0].length;
  const k = Math.max(0.2, Math.cos((lat0 * Math.PI) / 180));
  const scaled = best.map((r) => r.map(([x, y]) => [x * k, y] as [number, number]));
  const precision = Math.max(0.005, Math.sqrt(bestArea) / 111 / 40);
  const p = polylabel(scaled, precision);
  return [+(p[0] / k).toFixed(4), +p[1].toFixed(4)];
}

export function bbox(g: { type: string; coordinates: unknown }): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (c: unknown): void => {
    if (typeof (c as number[])[0] === 'number') {
      const [x, y] = c as number[];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else (c as unknown[]).forEach(walk);
  };
  walk(g.coordinates);
  return [minX, minY, maxX, maxY];
}

export function pointInGeom(pt: LngLat, g: RegionGeom): boolean {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const p of polys) {
    if (inRing(pt, p[0]) && !p.slice(1).some((h) => inRing(pt, h))) return true;
  }
  return false;
}

function inRing([x, y]: LngLat, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
