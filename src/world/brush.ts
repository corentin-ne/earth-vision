// The brush's precise side: taking exactly the land under a shape (a lasso loop, or the path a
// round brush swept), cutting the regions the shape's edge runs through.
import { difference, intersection, union, type Geom } from 'polyclip-ts';
import type { Position } from 'geojson';
import type { LngLat, RegionGeom } from '../types';
import { bbox, geomArea, pointInGeom } from '../geo/engine';
import { snapTo } from '../geo/split';
import { barriers, naturalOn } from '../geo/barriers';
import { useWorld, cutRegions, transferRegions, regionsInBox, endGroup } from './store';

const get = useWorld.getState;

/** A region mostly inside the shape goes whole; one barely touched is left alone. */
const WHOLE = 0.97;
const NOTHING = 0.012;

const closed = (ring: LngLat[]): Position[] => {
  const r: Position[] = ring.map((p) => [p[0], p[1]]);
  if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push([...r[0]]);
  return r;
};

const toGeom = (g: Geom): RegionGeom | null => {
  const polys = (g as Position[][][]).filter((p) => p.length && p[0].length >= 4);
  if (!polys.length) return null;
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
};

const asGeom = (g: RegionGeom) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as Geom;

/**
 * Gives the land inside `shape` (one or more polygons, as polyclip geometry) to country `cid`.
 * With `cut`, regions the edge runs through are split and only the inside part changes hands;
 * without, a region goes whole when most of it (or its middle) is inside. One undo step.
 * Returns how many regions (or parts) changed hands.
 */
export function takeShape(shape: Geom, cid: string, opts: { cut: boolean; label?: string } = { cut: true }): number {
  const { doc, geoms } = get();
  if (!doc) return 0;
  const shapeGeom = toGeom(shape);
  if (!shapeGeom) return 0;
  const box = bbox(shapeGeom);
  const group = `shape:${Date.now()}`;
  const label = opts.label ?? `Paint ${doc.countries[cid]?.name ?? 'unclaimed'}`;
  const inside = (p: LngLat) => pointInGeom(p, shapeGeom);
  const whole: number[] = [];
  const toCut: number[] = [];
  for (const id of regionsInBox(box)) {
    const r = doc.regions[id];
    const g = geoms[id];
    if (!r || !g || r.cid === cid) continue;
    let share: number;
    try {
      const part = toGeom(intersection(asGeom(g), shape));
      share = part ? geomArea(part) / (geomArea(g) || 1) : 0;
    } catch {
      continue;
    }
    if (share >= WHOLE || (!opts.cut && (share > 0.5 || (share > 0.2 && inside([r.cx, r.cy]))))) whole.push(id);
    else if (opts.cut && share > NOTHING) toCut.push(id);
  }
  // The pieces inside the shape, once the regions on its edge have been cut along it.
  const insidePieces = new Set<RegionGeom>();
  const cut = cutRegions(
    toCut,
    (g) => {
      try {
        const a = toGeom(intersection(asGeom(g), shape));
        const b = toGeom(difference(asGeom(g), shape));
        if (!a || !b) return null;
        // Back onto the region's own points where the clipper nudged them, so neighbours still match.
        const [ia, ob] = [snapTo(a, g), snapTo(b, g)];
        insidePieces.add(ia);
        return [ob, ia];
      } catch {
        return null;
      }
    },
    { label, group },
  );
  const after = get();
  const taken = [...whole];
  for (const pids of Object.values(cut))
    for (const pid of pids) {
      const g = after.geoms[pid];
      const r = after.doc!.regions[pid];
      // cutRegions keeps the geometry objects it was given: the inside piece is recognised by
      // identity, with the label point as a fallback (shapes are repaired on the way in).
      if (g && r && (insidePieces.has(g) || inside([r.cx, r.cy]))) taken.push(pid);
    }
  const n = taken.length ? transferRegions(taken, cid, { group, label }) : 0;
  endGroup();
  return n;
}

/** The land inside a loop drawn on the map. */
export function paintLasso(loop: LngLat[], cid: string, cut: boolean): number {
  if (loop.length < 3) return 0;
  return takeShape([[closed(loop)]] as Geom, cid, { cut });
}

/**
 * The shape a round brush of `radius` (degrees of latitude) sweeps along `path`: discs joined by
 * straight strokes, widened east–west as the map is away from the equator.
 */
export function strokeShape(path: LngLat[], radius: number): Geom | null {
  if (!path.length || radius <= 0) return null;
  // Points closer than a third of the radius add nothing.
  const pts: LngLat[] = [path[0]];
  for (const p of path) {
    const q = pts[pts.length - 1];
    const k = Math.cos((p[1] * Math.PI) / 180) || 1;
    if (Math.hypot((p[0] - q[0]) * k, p[1] - q[1]) >= radius / 3) pts.push(p);
  }
  const parts: Geom[] = [];
  const N = 16;
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const k = Math.max(0.2, Math.cos((y * Math.PI) / 180));
    const disc: Position[] = [];
    for (let a = 0; a < N; a++) disc.push([x + (Math.cos((a / N) * 2 * Math.PI) * radius) / k, y + Math.sin((a / N) * 2 * Math.PI) * radius]);
    disc.push([...disc[0]]);
    parts.push([[disc]] as Geom);
    if (i) {
      const [px, py] = pts[i - 1];
      const dx = (x - px) * k;
      const dy = y - py;
      const len = Math.hypot(dx, dy) || 1;
      const nx = ((-dy / len) * radius) / k;
      const ny = (dx / len) * radius;
      parts.push([[[[px + nx, py + ny], [x + nx, y + ny], [x - nx, y - ny], [px - nx, py - ny], [px + nx, py + ny]]]] as Geom);
    }
  }
  try {
    return parts.length === 1 ? parts[0] : union(parts[0], ...parts.slice(1));
  } catch {
    return null;
  }
}

/** The land a round brush swept, cut out of the regions it only partly covered. */
export function paintStroke(path: LngLat[], radius: number, cid: string): number {
  const shape = strokeShape(path, radius);
  return shape ? takeShape(shape, cid, { cut: true }) : 0;
}

/**
 * A drawn loop pulled onto the rivers and crests it runs along: every point within `reach`
 * degrees of an active line moves onto it. With natural borders on, a lasso drawn roughly along
 * a river then cuts along the river itself.
 */
export function magnetize(loop: LngLat[], reach: number): LngLat[] {
  const b = barriers();
  const o = get().natural;
  if (!b || !naturalOn(o)) return loop;
  const out: LngLat[] = [];
  for (const p of loop) {
    const q = b.nearest(p, o, reach) ?? p;
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  return out.length >= 3 ? out : loop;
}
