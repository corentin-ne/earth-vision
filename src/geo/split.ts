import { difference, intersection, type Geom } from 'polyclip-ts';
import type { Position } from 'geojson';
import type { LngLat, RegionGeom } from '../types';
import { bbox, pointInGeom } from './engine';

type Rect = [number, number, number, number];

/** Position of a point on the rectangle perimeter, counter-clockwise from the bottom-left corner, in [0, 4). */
function perimeterT([x, y]: LngLat, [x0, y0, x1, y1]: Rect): number {
  const e = 1e-9;
  if (Math.abs(y - y0) < e) return (x - x0) / (x1 - x0); // bottom, left → right
  if (Math.abs(x - x1) < e) return 1 + (y - y0) / (y1 - y0); // right, bottom → top
  if (Math.abs(y - y1) < e) return 2 + (x1 - x) / (x1 - x0); // top, right → left
  return 3 + (y1 - y) / (y1 - y0); // left, top → bottom
}

function corner(i: number, [x0, y0, x1, y1]: Rect): LngLat {
  return ([[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as LngLat[])[i % 4];
}

/** Intersections of segment p→q with the rectangle border, sorted along the segment. */
function segRect(p: LngLat, q: LngLat, [x0, y0, x1, y1]: Rect): { t: number; pt: LngLat }[] {
  const out: { t: number; pt: LngLat }[] = [];
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const tryX = (x: number) => {
    if (dx === 0) return;
    const t = (x - p[0]) / dx;
    const y = p[1] + t * dy;
    if (t >= 0 && t <= 1 && y >= y0 && y <= y1) out.push({ t, pt: [x, y] });
  };
  const tryY = (y: number) => {
    if (dy === 0) return;
    const t = (y - p[1]) / dy;
    const x = p[0] + t * dx;
    if (t >= 0 && t <= 1 && x >= x0 && x <= x1) out.push({ t, pt: [x, y] });
  };
  tryX(x0);
  tryX(x1);
  tryY(y0);
  tryY(y1);
  return out.sort((a, b) => a.t - b.t);
}

/**
 * The part of a large rectangle lying to one side of the polyline: the line
 * (extended past both ends) closed by walking the rectangle border.
 */
function sidePolygon(line: LngLat[], rect: Rect): LngLat[] | null {
  const span = Math.hypot(rect[2] - rect[0], rect[3] - rect[1]) * 2;
  const ext = (a: LngLat, b: LngLat): LngLat => {
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    return [a[0] + ((a[0] - b[0]) / d) * span, a[1] + ((a[1] - b[1]) / d) * span];
  };
  const pts: LngLat[] = [ext(line[0], line[1]), ...line, ext(line[line.length - 1], line[line.length - 2])];

  let entry: { seg: number; pt: LngLat } | null = null;
  let exit: { seg: number; pt: LngLat } | null = null;
  for (let i = 0; i < pts.length - 1 && !entry; i++) {
    const hits = segRect(pts[i], pts[i + 1], rect);
    if (hits.length) entry = { seg: i, pt: hits[0].pt };
  }
  for (let i = pts.length - 2; i >= 0 && !exit; i--) {
    const hits = segRect(pts[i], pts[i + 1], rect);
    if (hits.length) exit = { seg: i, pt: hits[hits.length - 1].pt };
  }
  if (!entry || !exit) return null;

  const ring: LngLat[] = [entry.pt, ...pts.slice(entry.seg + 1, exit.seg + 1), exit.pt];
  // Walk counter-clockwise along the border from the exit back to the entry.
  const tA = perimeterT(entry.pt, rect);
  let tB = perimeterT(exit.pt, rect);
  if (tA <= tB) tB -= 4;
  for (let c = Math.ceil(tB); c < tA; c++) {
    if (c > tB) ring.push(corner(((c % 4) + 4) % 4, rect));
  }
  ring.push(entry.pt);
  return ring;
}

function toGeom(mp: Geom): RegionGeom | null {
  const polys = (mp as Position[][][]).filter((p) => p.length && p[0].length >= 4);
  if (!polys.length) return null;
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
}

const key = (x: number, y: number) => `${x.toFixed(7)},${y.toFixed(7)}`;

/** Snap output vertices back onto the exact input vertices the clipper may have nudged. */
function snapTo(g: RegionGeom, ref: RegionGeom): RegionGeom {
  const exact = new Map<string, Position>();
  const polysRef = ref.type === 'Polygon' ? [ref.coordinates] : ref.coordinates;
  for (const p of polysRef) for (const r of p) for (const c of r) exact.set(key(c[0], c[1]), c);
  const fix = (r: Position[]) => r.map((c) => exact.get(key(c[0], c[1])) ?? c);
  return g.type === 'Polygon'
    ? { type: 'Polygon', coordinates: g.coordinates.map(fix) }
    : { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map(fix)) };
}

/** Splits a region geometry along a polyline. Returns null when the line doesn't cut it in two. */
/** Whether the drawn polyline actually reaches the shape (crosses an edge or has a point inside). */
function touches(g: RegionGeom, line: LngLat[]): boolean {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  if (line.some((p) => pointInGeom(p, g))) return true;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    for (const p of polys)
      for (const r of p)
        for (let j = 1; j < r.length; j++) if (segmentsCross(a, b, r[j - 1] as LngLat, r[j] as LngLat)) return true;
  }
  return false;
}

function segmentsCross(p1: LngLat, p2: LngLat, p3: LngLat, p4: LngLat): boolean {
  const d = (a: LngLat, b: LngLat, c: LngLat) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function splitGeom(g: RegionGeom, line: LngLat[]): [RegionGeom, RegionGeom] | null {
  if (line.length < 2 || !touches(g, line)) return null;
  const [x0, y0, x1, y1] = bbox(g);
  const m = Math.max(x1 - x0, y1 - y0) * 0.5 + 0.5;
  const rect: Rect = [x0 - m, y0 - m, x1 + m, y1 + m];
  const side = sidePolygon(line, rect);
  if (!side) return null;
  const subject = (g.type === 'Polygon' ? g.coordinates : g.coordinates) as Geom;
  const clip = [side] as Geom;
  const a = toGeom(intersection(subject, clip));
  const b = toGeom(difference(subject, clip));
  if (!a || !b) return null;
  return [snapTo(a, g), snapTo(b, g)];
}

/**
 * Vertices created where the cut meets the old border also have to exist on the
 * neighbour's side of that border, otherwise the shared arc breaks in two.
 * Returns the neighbours that needed a vertex inserted.
 */
export function insertCutVertices(
  pieces: RegionGeom[],
  original: RegionGeom,
  neighbors: Record<number, RegionGeom>,
): Record<number, RegionGeom> {
  const old = new Set<string>();
  const polysO = original.type === 'Polygon' ? [original.coordinates] : original.coordinates;
  for (const p of polysO) for (const r of p) for (const c of r) old.add(key(c[0], c[1]));
  const fresh: Position[] = [];
  for (const g of pieces) {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const p of polys) for (const r of p) for (const c of r) if (!old.has(key(c[0], c[1]))) fresh.push(c);
  }
  const changed: Record<number, RegionGeom> = {};
  if (!fresh.length) return changed;
  for (const [id, g] of Object.entries(neighbors)) {
    let touched = false;
    const fixRing = (ring: Position[]): Position[] => {
      const out: Position[] = [ring[0]];
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1];
        const b = ring[i];
        const on = fresh.filter((v) => onSegment(v, a, b));
        if (on.length) {
          on.sort((u, v) => dist2(a, u) - dist2(a, v));
          out.push(...on);
          touched = true;
        }
        out.push(b);
      }
      return out;
    };
    const ng: RegionGeom =
      g.type === 'Polygon'
        ? { type: 'Polygon', coordinates: g.coordinates.map(fixRing) }
        : { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map(fixRing)) };
    if (touched) changed[Number(id)] = ng;
  }
  return changed;
}

const dist2 = (a: Position, b: Position) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

function onSegment(p: Position, a: Position, b: Position): boolean {
  const minX = Math.min(a[0], b[0]) - 1e-9, maxX = Math.max(a[0], b[0]) + 1e-9;
  const minY = Math.min(a[1], b[1]) - 1e-9, maxY = Math.max(a[1], b[1]) + 1e-9;
  if (p[0] < minX || p[0] > maxX || p[1] < minY || p[1] > maxY) return false;
  if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1])) return false;
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return Math.abs(cross) / (len || 1) < 1e-7;
}
