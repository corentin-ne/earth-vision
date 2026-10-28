// The brush's precise side: taking exactly the land under a shape (a lasso loop, or the path a
// round brush swept), cutting the regions the shape's edge runs through.
import { difference, intersection, union, type Geom } from 'polyclip-ts';
import type { MultiPolygon, Position } from 'geojson';
import type { LngLat, RegionGeom } from '../types';
import { bbox, geomArea, pointInGeom } from '../geo/engine';
import { snapTo } from '../geo/split';
import { barriers, naturalOn } from '../geo/barriers';
import { useWorld, cutRegions, transferRegions, regionsInBox, endGroup, engine } from './store';
import { activeNatural, cutAlongNature } from './natural';
import { addLand } from './edits';

const get = useWorld.getState;

type Box = [number, number, number, number];

/** A region mostly inside the shape goes whole; one barely touched is left alone. */
const WHOLE = 0.97;
const NOTHING = 0.012;
/** A pocket of land (closed off by rivers, crests and coast) this much inside goes whole. */
const POCKET = 0.6;
/** An island this much inside a lasso goes whole. */
const ISLAND = 0.25;

/** The smart parts of claiming, each on its own switch in the brush's options. */
export interface Smart {
  /** An island the lasso or brush reaches goes whole. */
  islands: boolean;
  /** With natural borders on: land closed off by rivers, crests and coast goes whole when mostly inside. */
  pockets: boolean;
  /** A lasso drawn near a river or crest clings to it. */
  follow: boolean;
}
export const SMART_DEFAULT: Smart = { islands: true, pockets: true, follow: true };

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

const partsOf = (g: RegionGeom): Position[][][] => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
const multi = (ps: Position[][][]): RegionGeom => (ps.length === 1 ? { type: 'Polygon', coordinates: ps[0] } : { type: 'MultiPolygon', coordinates: ps });
const poly = (p: Position[][]): RegionGeom => ({ type: 'Polygon', coordinates: p });
const within = (a: Box, b: Box) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];

/**
 * Which parts of region `id` are islands: they share no border with any other region (sea or a
 * lake all around). A part that meets a neighbour shares its vertices.
 */
export function islandParts(id: number): boolean[] {
  const geoms = get().geoms;
  const g = geoms[id];
  if (!g) return [];
  const shared = new Set<string>();
  for (const m of engine.neighbors(id)) {
    const n = geoms[m];
    if (n) for (const p of partsOf(n)) for (const v of p[0]) shared.add(`${v[0]},${v[1]}`);
  }
  return partsOf(g).map((p) => {
    let k = 0;
    for (const v of p[0]) if (shared.has(`${v[0]},${v[1]}`) && ++k >= 2) return false;
    return true;
  });
}

export interface TakeOpts {
  cut: boolean;
  label?: string;
  separate?: boolean;
  group?: string;
  countries?: boolean;
  /** An island at least this share of which is inside goes whole (0: any touch); off when unset. */
  islands?: number;
  /** With natural borders on, land closed off by them that is mostly inside goes whole. */
  pockets?: boolean;
  /** Islands and pockets go whole only when they fit in this box (the map on screen). */
  view?: Box;
  /** A tap: the island or pocket under it goes whole. */
  at?: LngLat;
}

/**
 * The land inside `shape` (one or more polygons, as polyclip geometry): given to country `cid`,
 * or, with `separate`, only split off as regions of its own (same owner). With `cut`, regions
 * the edge runs through are split and only the inside part counts; without, a region counts
 * whole when most of it (or its middle) is inside. Parts wholly inside, and the islands and
 * pockets the options name, come off whole along their own outline. One undo step. Returns the
 * regions (or new parts) inside.
 */
export function takeShape(shape: Geom, cid: string, opts: TakeOpts = { cut: true }): number[] {
  if (!get().doc) return [];
  const shapeGeom = toGeom(shape);
  if (!shapeGeom) return [];
  const box = bbox(shapeGeom);
  const shapeArea = geomArea(shapeGeom);
  const group = opts.group ?? `shape:${Date.now()}`;
  const label = opts.label ?? (opts.separate ? 'Separate into a region' : `Paint ${get().doc!.countries[cid]?.name ?? 'unclaimed'}`);
  const inside = (p: LngLat) => pointInGeom(p, shapeGeom);
  const mine = (id: number) => !!get().doc!.regions[id] && !!get().geoms[id] && (!!opts.separate || get().doc!.regions[id].cid !== cid);
  /** How much land of each part of a region lies inside the shape; null when the clipper gives up. */
  const insideAreas = (g: RegionGeom) => {
    try {
      return partsOf(g).map((p) => {
        const part = toGeom(intersection([p] as Geom, shape));
        return part ? geomArea(part) : 0;
      });
    } catch {
      return null;
    }
  };
  let ids = regionsInBox(box).filter(mine);
  const natural = opts.pockets ? activeNatural() : null;
  if (natural) {
    // Pockets: the land touched is first cut along the rivers and crests passing near the shape,
    // so each piece lies on one side of them and can be weighed on its own.
    const w = (box[2] - box[0]) / 2;
    const h = (box[3] - box[1]) / 2;
    const touched = ids.filter((id) => insideAreas(get().geoms[id])?.some((a) => a > 0) || (!!opts.at && pointInGeom(opts.at, get().geoms[id])));
    const pieces = cutAlongNature(touched, { group, near: [box[0] - w, box[1] - h, box[2] + w, box[3] + h] });
    ids = [...new Set([...ids.filter((id) => !touched.includes(id)), ...pieces])].filter(mine);
  }
  const { doc, geoms } = get();
  const whole: number[] = [];
  const toCut: number[] = [];
  /** For a region on the edge, what becomes of each of its parts. */
  const plan = new Map<number, ('in' | 'out' | 'cut')[]>();
  /** Land inside the shape of each part to be cut along it. */
  const cutIns = new Map<number, number[]>();
  let pocketArea = 0;
  for (const id of ids) {
    const r = doc!.regions[id];
    const g = geoms[id];
    const ins = insideAreas(g);
    if (!ins) continue;
    const polys = partsOf(g);
    const areas = polys.map((p) => geomArea(poly(p)));
    const share = ins.reduce((a, b) => a + b, 0) / (areas.reduce((a, b) => a + b, 0) || 1);
    const isl = opts.islands != null ? islandParts(id) : null;
    const fits = (p: Position[][]) => !opts.view || within(bbox(poly(p)), opts.view);
    let parts = polys.map((p, i): 'in' | 'out' | 'cut' => {
      const sh = ins[i] / (areas[i] || 1);
      if (sh >= 0.995) return 'in';
      const tapped = !!opts.at && pointInGeom(opts.at, poly(p));
      if (!(ins[i] > 0) && !tapped) return 'out';
      if (isl?.[i] && fits(p) && (tapped || sh >= opts.islands!)) return 'in';
      if (natural && fits(p) && (tapped || sh >= POCKET)) {
        pocketArea += areas[i];
        return 'in';
      }
      // Barely touched, next to the part and to the shape both: a small loop in a huge region (a
      // Brazilian state) still counts.
      if (ins[i] < NOTHING * Math.min(areas[i], shapeArea)) return 'out';
      return 'cut';
    });
    if (!opts.cut) {
      // Whole regions: most of it inside, or its middle and a good part of it.
      if (share >= WHOLE || (!parts.includes('in') && (share > 0.5 || (share > 0.2 && inside([r.cx, r.cy]))))) {
        whole.push(id);
        continue;
      }
      parts = parts.map((d) => (d === 'cut' ? 'out' : d));
    }
    plan.set(id, parts);
    cutIns.set(id, ins);
  }
  for (const [id, parts] of plan) {
    // A loop taking pockets whole is loose: what it spills over their rivers and coasts (less
    // than half as much land) is not taken.
    const ins = cutIns.get(id)!;
    if (pocketArea) parts.forEach((d, i) => d === 'cut' && ins[i] < pocketArea / 2 && (parts[i] = 'out'));
    if (parts.every((d) => d === 'in')) whole.push(id);
    else if (parts.some((d) => d !== 'out')) toCut.push(id);
  }
  // The pieces inside the shape, once the regions on its edge have been cut along it.
  const insidePieces = new Set<RegionGeom>();
  const cut = cutRegions(
    toCut,
    (g, r) => {
      const parts = plan.get(r.id);
      const polys = partsOf(g);
      if (!parts || parts.length !== polys.length) return null;
      const inP: Position[][][] = [];
      const outP: Position[][][] = [];
      try {
        polys.forEach((p, i) => {
          if (parts[i] === 'in') inP.push(p);
          else if (parts[i] === 'out') outP.push(p);
          else {
            const a = toGeom(intersection([p] as Geom, shape));
            const b = toGeom(difference([p] as Geom, shape));
            // Back onto the region's own points where the clipper nudged them, so neighbours still match.
            if (a) inP.push(...partsOf(snapTo(a, g)));
            if (b) outP.push(...partsOf(snapTo(b, g)));
          }
        });
      } catch {
        return null;
      }
      if (!inP.length || !outP.length) return null;
      const a = multi(inP);
      insidePieces.add(a);
      return [multi(outP), a];
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
  if (opts.countries) {
    // Whole countries: everything the owners of the land inside hold.
    const owners = new Set(taken.map((id) => get().doc!.regions[id]?.cid).filter((c) => c && c !== cid));
    const have = new Set(taken);
    for (const r of Object.values(get().doc!.regions)) if (owners.has(r.cid) && !have.has(r.id)) taken.push(r.id);
  }
  if (!opts.separate && taken.length) transferRegions(taken, cid, { group, label });
  if (!opts.group) endGroup();
  return opts.separate ? taken : taken.filter((id) => get().doc!.regions[id]?.cid === cid);
}

/**
 * A brush dab landing only on islands of a region, not on its mainland, takes just those
 * islands: they come off the region first. `pts` are points of the dab. Returns the ids to take
 * in place of `ids`.
 */
export function islandsUnder(ids: number[], pts: LngLat[], opts: { group?: string; label?: string; view?: Box } = {}): number[] {
  const out: number[] = [];
  for (const id of ids) {
    const g = get().geoms[id];
    const hit = g?.type === 'MultiPolygon' ? g.coordinates.map((p) => pts.some((q) => pointInGeom(q, poly(p)))) : [];
    const isl = hit.length ? islandParts(id) : [];
    const fits = (i: number) => !opts.view || within(bbox(poly((g as MultiPolygon).coordinates[i])), opts.view);
    if (!hit.some(Boolean) || hit.every(Boolean) || !hit.every((h, i) => !h || (isl[i] && fits(i)))) {
      out.push(id);
      continue;
    }
    const ps = (g as MultiPolygon).coordinates;
    const cut = cutRegions([id], () => [multi(ps.filter((_, i) => !hit[i])), multi(ps.filter((_, i) => hit[i]))], { label: opts.label, group: opts.group });
    for (const pid of cut[id] ?? [id]) if (pts.some((q) => pointInGeom(q, get().geoms[pid]))) out.push(pid);
  }
  return out;
}

/**
 * What a loop drawn with the Split tool circles becomes regions of its own: an island comes off
 * the region it belonged to, anything else is cut along the loop. Ownership does not change.
 * Returns the regions inside the loop (to select them).
 */
export function separateLasso(loop: LngLat[]): number[] {
  if (loop.length < 3) return [];
  return takeShape(loopShape(loop), '', { cut: true, separate: true });
}

export type LassoClaim = 'exact' | 'regions' | 'countries';

/**
 * Draw to claim: what a loop drawn on the map gives to country `cid`. 'exact' is the drawn
 * shape itself (regions on its edge are cut), 'regions' every region mostly inside, 'countries'
 * the whole of every country with land inside. With `sea`, the part of the loop over the sea
 * becomes new land of the country too. `smart` says which islands and pockets go whole; `view` is
 * the map on screen (what does not fit in it is never taken whole that way). One undo step.
 * Returns how many regions changed hands or were raised.
 */
export function paintLasso(loop: LngLat[], cid: string, claim: LassoClaim | boolean = 'exact', sea = false, smart: Partial<Smart> = SMART_DEFAULT, view?: Box): number {
  if (loop.length < 3) return 0;
  // (A boolean is the old "cut regions" switch.)
  const mode: LassoClaim = claim === true ? 'exact' : claim === false ? 'regions' : claim;
  const group = `lasso:${Date.now()}`;
  const label = `${get().doc?.countries[cid]?.name ?? 'Unclaimed land'} claims the drawn land`;
  const { islands = true, pockets = true } = smart;
  let n = takeShape(loopShape(loop), cid, { cut: mode === 'exact', countries: mode === 'countries', group, label, islands: islands ? ISLAND : undefined, pockets, view }).length;
  if (sea && addLand(loop, cid, { group, quiet: true, label }) != null) n++;
  endGroup();
  return n;
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

/**
 * The land a round brush swept, cut out of the regions it only partly covered. Islands it
 * touches go whole, and a tap takes the pocket of land under it (as `smart` says, within `view`).
 */
export function paintStroke(path: LngLat[], radius: number, cid: string, smart: Partial<Smart> = SMART_DEFAULT, view?: Box): number {
  const shape = strokeShape(path, radius);
  if (!shape) return 0;
  const { islands = true, pockets = true } = smart;
  // A tap: the brush never left the spot it went down on.
  const k = Math.cos((path[0][1] * Math.PI) / 180) || 1;
  const tap = path.every((p) => Math.hypot((p[0] - path[0][0]) * k, p[1] - path[0][1]) < radius);
  return takeShape(shape, cid, { cut: true, islands: islands ? 0 : undefined, pockets, view, at: tap ? path[0] : undefined }).length;
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
  const push = (q: LngLat) => {
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  };
  const hits = loop.map((p) => b.nearestAt(p, o, reach));
  for (let i = 0; i < loop.length; i++) {
    const h = hits[i];
    const prev = hits[i - 1];
    // Two points in a row on the same line: follow it between them, every bend, rather than
    // cutting straight across (the loop was drawn along it, so its vertices are few and far).
    if (h && prev && prev.line === h.line) for (const v of b.between(h.line, prev, h)) push(v);
    push(h?.q ?? loop[i]);
  }
  const first = hits[0];
  const last = hits[loop.length - 1];
  if (first && last && first.line === last.line) for (const v of b.between(first.line, last, first)) push(v);
  return out.length >= 3 ? out : loop;
}

/**
 * A freehand loop as clean polygons: where it crosses itself it is untangled, and anything it
 * encloses counts as inside (no holes where strokes overlap).
 */
export function loopShape(loop: LngLat[]): Geom {
  const raw = [[closed(loop)]] as Geom;
  try {
    const u = union(raw) as Position[][][];
    const outer = u.filter((p) => p.length && p[0].length >= 4).map((p) => [p[0]]);
    return outer.length ? (outer as Geom) : raw;
  } catch {
    return raw;
  }
}
