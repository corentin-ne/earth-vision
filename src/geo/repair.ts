// Keeping region shapes valid. Every edit goes through `cleanGeom` (see store.commit), and worlds
// are checked when they open: a shape with open rings, spikes, zero-area loops or stray holes is
// rebuilt instead of being saved. Broken shapes cannot be filled by the map and they break the
// arc-based merge of regions and countries (borders used twice are taken for inner ones).
import { union, xor, type Geom } from 'polyclip-ts';
import type { Position } from 'geojson';
import type { RegionGeom } from '../types';

type Ring = Position[];

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
const finite = (p: Position) => Number.isFinite(p[0]) && Number.isFinite(p[1]);

function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
}

function inRing([x, y]: Position, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Areas below this (degrees², a few m²) are no area at all. */
const NO_AREA = 1e-10;

/** What is wrong with a shape (empty when it is fine). */
export function geomIssues(g: RegionGeom | null | undefined): string[] {
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return ['not a polygon'];
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  if (!polys.length) return ['empty'];
  const out: string[] = [];
  polys.forEach((poly, pi) => {
    if (!poly.length) out.push(`part ${pi} empty`);
    poly.forEach((ring, ri) => {
      const where = `part ${pi} ring ${ri}`;
      if (ring.length < 4) return void out.push(`${where}: too few points`);
      if (!ring.every(finite)) return void out.push(`${where}: invalid coordinates`);
      if (!same(ring[0], ring[ring.length - 1])) return void out.push(`${where}: not closed`);
      if (Math.abs(ringArea(ring)) < NO_AREA) return void out.push(`${where}: no area`);
      // A spike: out to a point and straight back along the same edge. (A point repeated twice in a
      // row is harmless, it is skipped.)
      const pts = ring.slice(0, -1).filter((p, i, a) => i === 0 || !same(p, a[i - 1]));
      const n = pts.length;
      for (let i = 0; i < n; i++) if (same(pts[(i + n - 1) % n], pts[(i + 1) % n])) return void out.push(`${where}: spike`);
      if (ri > 0 && !ring.some((p) => inRing(p, poly[0]))) out.push(`${where}: hole outside its shape`);
    });
  });
  return out;
}

type Graph = Map<string, { p: Position; next: Set<string> }>;
const key = (p: Position) => `${p[0]},${p[1]}`;

/** The neighbours' outlines as a graph of points and edges. */
function outlineGraph(neighbours: Ring[]): Graph {
  const graph: Graph = new Map();
  for (const ring of neighbours)
    for (let i = 0; i + 1 < ring.length; i++) {
      const a = key(ring[i]);
      const b = key(ring[i + 1]);
      if (a === b) continue;
      if (!graph.has(a)) graph.set(a, { p: ring[i], next: new Set() });
      if (!graph.has(b)) graph.set(b, { p: ring[i + 1], next: new Set() });
      graph.get(a)!.next.add(b);
      graph.get(b)!.next.add(a);
    }
  return graph;
}

/**
 * The shortest way from `from` to `to` along the neighbours' outlines (it may run along several
 * of them), or null when there is none within `maxLength` (degrees).
 */
function along(graph: Graph, from: Position, to: Position, maxLength = Infinity): Ring | null {
  const start = key(from);
  const goal = key(to);
  if (!graph.has(start) || !graph.has(goal)) return null;
  const dist = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, string>();
  const todo = new Set([start]);
  while (todo.size) {
    let cur = '';
    let best = Infinity;
    for (const k of todo) if (dist.get(k)! < best) [cur, best] = [k, dist.get(k)!];
    todo.delete(cur);
    if (cur === goal || best > maxLength) break;
    const here = graph.get(cur)!;
    for (const n of here.next) {
      const d = best + Math.hypot(graph.get(n)!.p[0] - here.p[0], graph.get(n)!.p[1] - here.p[1]);
      if (d < (dist.get(n) ?? Infinity)) {
        dist.set(n, d);
        prev.set(n, cur);
        todo.add(n);
      }
    }
  }
  if (!dist.has(goal) || dist.get(goal)! > maxLength) return null;
  const path: Ring = [];
  for (let k: string | undefined = goal; k; k = prev.get(k)) path.unshift(graph.get(k)!.p);
  return path;
}

/**
 * Lays a closed ring onto its neighbours: an edge whose two ends are points of a neighbouring
 * outline but which is not an edge of it (a straight shortcut where the neighbour has a bend, a
 * T-junction) is replaced by the neighbour's path, so the two share the same border exactly.
 */
function alignToNeighbours(ring: Ring, graph: Graph): Ring {
  if (!graph.size) return ring;
  const out: Ring = [ring[0]];
  for (let i = 0; i + 1 < ring.length; i++) {
    const u = ring[i];
    const v = ring[i + 1];
    const ku = key(u);
    const kv = key(v);
    const node = graph.get(ku);
    if (node && graph.has(kv) && !node.next.has(kv)) {
      const chord = Math.hypot(v[0] - u[0], v[1] - u[1]);
      const path = along(graph, u, v, chord * 1.6);
      if (path && path.length > 2) {
        out.push(...path.slice(1));
        continue;
      }
    }
    out.push(v);
  }
  return out;
}

/**
 * Joins open pieces of outline end to end. Where two pieces don't meet, the gap is filled with
 * the matching stretch of a neighbouring region's outline when one has both ends (that is where
 * the lost border ran), else with a straight line.
 */
function stitch(pieces: Ring[], graph: Graph): Ring[] {
  const closed: Ring[] = [];
  const open: Ring[] = [];
  for (const r of pieces) (r.length > 2 && same(r[0], r[r.length - 1]) ? closed : open).push(r);
  const bridge = (from: Position, to: Position): Ring => along(graph, from, to) ?? [from, to];
  while (open.length) {
    let cur = open.pop()!;
    for (let guard = 0; guard < 10000 && !same(cur[0], cur[cur.length - 1]); guard++) {
      const end = cur[cur.length - 1];
      let k = open.findIndex((r) => same(r[0], end));
      if (k >= 0) {
        cur = [...cur, ...open.splice(k, 1)[0].slice(1)];
        continue;
      }
      k = open.findIndex((r) => same(r[r.length - 1], end));
      if (k >= 0) {
        cur = [...cur, ...open.splice(k, 1)[0].reverse().slice(1)];
        continue;
      }
      // A gap: go to the nearest loose end (or back to the start), along a neighbour if possible.
      let target = cur[0];
      let at = -1;
      let best = Math.hypot(end[0] - target[0], end[1] - target[1]);
      open.forEach((r, idx) => {
        const d = Math.hypot(end[0] - r[0][0], end[1] - r[0][1]);
        if (d < best) {
          best = d;
          target = r[0];
          at = idx;
        }
      });
      const path = bridge(end, target);
      cur = [...cur, ...path.slice(1)];
      if (at >= 0) cur = [...cur, ...open.splice(at, 1)[0].slice(1)];
    }
    if (!same(cur[0], cur[cur.length - 1])) cur.push(cur[0]);
    closed.push(cur);
  }
  return closed;
}

/** Turns polyclip output back into a region shape (null when nothing with an area is left). */
function toGeom(mp: [number, number][][][]): RegionGeom | null {
  const polys = mp.filter((poly) => poly.length && Math.abs(ringArea(poly[0])) >= NO_AREA).map((poly) => poly.filter((r, i) => i === 0 || Math.abs(ringArea(r)) >= NO_AREA));
  if (!polys.length) return null;
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
}

/**
 * Rebuilds a broken shape: invalid points dropped, open pieces joined (gaps filled along
 * `neighbours`' outlines), then the even-odd area of all its rings recomputed, which removes
 * spikes, zero-area loops and crossings and puts holes where they belong.
 */
export function repairGeom(g: RegionGeom, neighbours: Ring[] = []): RegionGeom | null {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const rings: Ring[] = [];
  for (const poly of polys)
    for (const ring of poly) {
      const r: Ring = [];
      for (const p of ring) if (finite(p) && (!r.length || !same(r[r.length - 1], p))) r.push([p[0], p[1]]);
      if (r.length >= 2) rings.push(r);
    }
  const graph = outlineGraph(neighbours);
  const closed = stitch(rings, graph)
    .map((r) => alignToNeighbours(r, graph))
    .filter((r) => r.length >= 4 && Math.abs(ringArea(r)) >= NO_AREA);
  if (!closed.length) return null;
  try {
    const shapes = closed.map((r) => [r as [number, number][]] as Geom);
    return toGeom(shapes.length === 1 ? union(shapes[0]) : xor(shapes[0], ...shapes.slice(1)));
  } catch {
    return null;
  }
}

/** The shape itself when it is valid, else its repair (or the original if even that fails). */
export function cleanGeom(g: RegionGeom, neighbours: Ring[] = []): RegionGeom {
  if (!geomIssues(g).length) return g;
  const fixed = repairGeom(g, neighbours);
  return fixed && !geomIssues(fixed).length ? fixed : fixed ?? g;
}

/** Union of several shapes (regions merged into one), always valid. */
export function unionGeoms(gs: RegionGeom[]): RegionGeom | null {
  const shapes: Geom[] = gs.map((g) => (g.type === 'Polygon' ? g.coordinates : g.coordinates) as Geom);
  if (!shapes.length) return null;
  try {
    const out = toGeom(union(shapes[0], ...shapes.slice(1)));
    // Shared borders that do not match to the last digit can leave hairline holes: drop them.
    if (!out) return null;
    const polys = out.type === 'Polygon' ? [out.coordinates] : out.coordinates;
    const total = polys.reduce((t, p) => t + Math.abs(ringArea(p[0])), 0);
    const kept = polys.map((p) => p.filter((r, i) => i === 0 || Math.abs(ringArea(r)) > total * 1e-6));
    return kept.length === 1 ? { type: 'Polygon', coordinates: kept[0] } : { type: 'MultiPolygon', coordinates: kept };
  } catch {
    return null;
  }
}
