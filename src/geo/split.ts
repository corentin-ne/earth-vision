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
  const seen = new Set<string>();
  for (const g of pieces) {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const p of polys)
      for (const r of p)
        for (const c of r) {
          const k = key(c[0], c[1]);
          if (old.has(k) || seen.has(k)) continue;
          seen.add(k);
          fresh.push(c);
        }
  }
  const changed: Record<number, RegionGeom> = {};
  if (!fresh.length) return changed;
  for (const [id, g] of Object.entries(neighbors)) {
    const ng = withVertices(g, fresh);
    if (ng) changed[Number(id)] = ng;
  }
  return changed;
}

/** `g` with each of `pts` that lies on one of its edges added as a vertex there (null when none does). */
function withVertices(g: RegionGeom, pts: Position[]): RegionGeom | null {
  let touched = false;
  const fixRing = (ring: Position[]): Position[] => {
    const out: Position[] = [ring[0]];
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1];
      const b = ring[i];
      const on = pts.filter((v) => onSegment(v, a, b));
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
    g.type === 'Polygon' ? { type: 'Polygon', coordinates: g.coordinates.map(fixRing) } : { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map(fixRing)) };
  return touched ? ng : null;
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

// ── Cutting along natural lines (rivers, crests) ─────────────────────────────

type Ring = Position[];
type Poly = Ring[];

interface Hit {
  /** Position along the line: segment index + fraction. */
  s: number;
  seg: number;
  pt: Position;
  ring: number;
  edge: number;
  u: number;
}

function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
}

function polyArea(p: Poly): number {
  let a = Math.abs(ringArea(p[0]));
  for (let i = 1; i < p.length; i++) a -= Math.abs(ringArea(p[i]));
  return a;
}

function inPoly(pt: Position, p: Poly): boolean {
  return pointInGeom(pt as LngLat, { type: 'Polygon', coordinates: p });
}

/** Where the line crosses the rings of the polygon, in order along the line. */
function lineHits(line: LngLat[], p: Poly): Hit[] {
  const hits: Hit[] = [];
  const boxes = p.map((r) => bbox({ type: 'LineString', coordinates: r }));
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const sx0 = Math.min(ax, bx), sx1 = Math.max(ax, bx), sy0 = Math.min(ay, by), sy1 = Math.max(ay, by);
    for (let ri = 0; ri < p.length; ri++) {
      const b = boxes[ri];
      if (sx1 < b[0] || sx0 > b[2] || sy1 < b[1] || sy0 > b[3]) continue;
      const r = p[ri];
      for (let j = 0; j < r.length - 1; j++) {
        const [cx, cy] = r[j];
        const [dx, dy] = r[j + 1];
        if (Math.max(cx, dx) < sx0 || Math.min(cx, dx) > sx1 || Math.max(cy, dy) < sy0 || Math.min(cy, dy) > sy1) continue;
        const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
        if (den === 0) continue;
        const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
        const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
        if (t < 0 || t > 1 || u < -1e-12 || u >= 1) continue;
        let pt: Position = [ax + t * (bx - ax), ay + t * (by - ay)];
        // On a vertex: reuse it exactly, so the neighbour that shares it still matches.
        if (Math.abs(pt[0] - cx) < 1e-9 && Math.abs(pt[1] - cy) < 1e-9) pt = r[j];
        else if (Math.abs(pt[0] - dx) < 1e-9 && Math.abs(pt[1] - dy) < 1e-9) continue; // the next edge has it at u = 0
        hits.push({ s: i - 1 + t, seg: i - 1, pt, ring: ri, edge: j, u: pt === r[j] ? 0 : u });
      }
    }
  }
  hits.sort((a, b) => a.s - b.s);
  // A line through a vertex hits both edges there: keep one.
  return hits.filter((h, k) => k === 0 || Math.abs(h.s - hits[k - 1].s) > 1e-12);
}

/** Vertices of a closed ring strictly after position (j1, u1) up to position (j2, u2), walking forward. */
function ringBetween(r: Ring, j1: number, u1: number, j2: number, u2: number): Position[] {
  const n = r.length - 1;
  const out: Position[] = [];
  if (j1 === j2 && u1 < u2) return out;
  let k = (j1 + 1) % n;
  out.push(r[k]);
  while (k !== j2) {
    k = (k + 1) % n;
    out.push(r[k]);
  }
  return out;
}

function closeRing(pts: Position[]): Ring | null {
  const out: Position[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  if (out.length < 3) return null;
  out.push(out[0]);
  return out;
}

/** Splits a polygon in two along a chord running inside it from one point of its outer ring to another. */
function splitByChord(p: Poly, a: Hit, b: Hit, inner: Position[]): [Poly, Poly] | null {
  const outer = p[0];
  const r1 = closeRing([a.pt, ...inner, b.pt, ...ringBetween(outer, b.edge, b.u, a.edge, a.u)]);
  const r2 = closeRing([b.pt, ...[...inner].reverse(), a.pt, ...ringBetween(outer, a.edge, a.u, b.edge, b.u)]);
  if (!r1 || !r2) return null;
  const p1: Poly = [r1];
  const p2: Poly = [r2];
  for (const hole of p.slice(1)) (inRing(hole[0], r1) ? p1 : p2).push(hole);
  return [p1, p2];
}

function inRing(pt: Position, ring: Ring): boolean {
  return pointInGeom(pt as LngLat, { type: 'Polygon', coordinates: [ring] });
}

/**
 * Cuts one polygon along the first stretch of a line that crosses it from border to border and
 * leaves two real pieces (not a sliver where a river wanders along the border). Null when none does.
 */
function cutOnce(p: Poly, lines: LngLat[][], minArea: number): [Poly, Poly] | null {
  const total = polyArea(p);
  for (const line of lines) {
    const hits = lineHits(line, p);
    for (let k = 0; k + 1 < hits.length; k++) {
      const a = hits[k];
      const b = hits[k + 1];
      if (a.ring !== 0 || b.ring !== 0) continue;
      const inner = line.slice(a.seg + 1, b.seg + 1) as Position[];
      const next = inner[0] ?? b.pt;
      if (!inPoly([(a.pt[0] + next[0]) / 2, (a.pt[1] + next[1]) / 2], p)) continue;
      const pieces = splitByChord(p, a, b, inner);
      if (!pieces) continue;
      const a1 = polyArea(pieces[0]);
      const a2 = polyArea(pieces[1]);
      // Both pieces must be real, and together exactly the polygon (else the chord was not clean).
      if (a1 < minArea || a2 < minArea || Math.abs(a1 + a2 - total) > total * 1e-6) continue;
      return pieces;
    }
  }
  return null;
}

/**
 * Cuts a region along every line (river, crest…) that crosses it from border to border. The first
 * piece is the largest and keeps the parts the lines don't touch (islands); null when nothing is cut.
 * `minShare` is the smallest piece kept, as a share of the region.
 */
export function cutGeom(g: RegionGeom, lines: LngLat[][], minShare = 0.015): RegionGeom[] | null {
  const polys: Poly[] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const minArea = polys.reduce((t, p) => t + polyArea(p), 0) * minShare;
  const cutParts: Poly[] = [];
  const untouched: Poly[] = [];
  for (const p of polys) {
    const queue = [p];
    const done: Poly[] = [];
    let cuts = 0;
    while (queue.length) {
      const q = queue.pop()!;
      // A winding river can cross a region many times: allow enough cuts to follow it all.
      const two = cuts < 2000 ? cutOnce(q, lines, minArea) : null;
      if (two) {
        cuts++;
        queue.push(...two);
      } else done.push(q);
    }
    if (cuts) cutParts.push(...done);
    else untouched.push(p);
  }
  if (!cutParts.length) return null;
  cutParts.sort((a, b) => polyArea(b) - polyArea(a));
  const asGeom = (ps: Poly[]): RegionGeom => (ps.length === 1 ? { type: 'Polygon', coordinates: ps[0] } : { type: 'MultiPolygon', coordinates: ps });
  return [asGeom([cutParts[0], ...untouched]), ...cutParts.slice(1).map((p) => asGeom([p]))];
}

// ── New land ─────────────────────────────────────────────────────────────────

/**
 * New land drawn as an outline: the part of it not already land, fitted exactly against the
 * regions it touches (their border vertices are reused, and the points where the outline meets
 * them are added to their side too). Returns null when the outline covers no new land.
 */
export function carveLand(outline: LngLat[], others: Record<number, RegionGeom>): { geom: RegionGeom; neighbours: Record<number, RegionGeom> } | null {
  if (outline.length < 3) return null;
  const ring: Position[] = outline.map((p) => [p[0], p[1]]);
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push([...ring[0]]);
  const drawn: RegionGeom = { type: 'Polygon', coordinates: [ring] };
  let subject = [[ring]] as Geom;
  const [x0, y0, x1, y1] = bbox(drawn);
  const near: Record<number, RegionGeom> = {};
  for (const [id, g] of Object.entries(others)) {
    const b = bbox(g);
    if (b[0] > x1 || b[2] < x0 || b[1] > y1 || b[3] < y0) continue;
    near[Number(id)] = g;
    subject = difference(subject, (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as Geom);
  }
  let geom = toGeom(subject);
  if (!geom) return null;
  // Slivers the clipper leaves along shared borders are dropped.
  const polys = (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates).filter((p) => Math.abs(ringArea(p[0])) > Math.abs(ringArea(ring)) * 0.002);
  if (!polys.length) return null;
  geom = polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
  for (const g of Object.values(near)) geom = snapTo(geom, g);
  // Both sides of a shared stretch need the same vertices: the neighbours get the points where
  // the outline meets them, and the new land gets their corners along it.
  const neighbours = insertCutVertices([geom], drawn, near);
  const corners: Position[] = [];
  for (const [id, g] of Object.entries(near)) {
    const gg = neighbours[Number(id)] ?? g;
    for (const p of gg.type === 'Polygon' ? [gg.coordinates] : gg.coordinates) for (const r of p) corners.push(...r);
  }
  geom = withVertices(geom, corners) ?? geom;
  return { geom, neighbours };
}
