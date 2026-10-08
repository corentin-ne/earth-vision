// Claiming land up to natural borders: regions crossed by an active river or crest are cut
// along it, and the brush / fill never reaches across one.
import type { LngLat, RegionGeom } from '../types';
import { Barriers, barriers, loadBarriers, naturalOn, type NaturalOpts } from '../geo/barriers';
import { bbox, pointInGeom } from '../geo/engine';
import { cutGeom } from '../geo/split';
import { useWorld, engine, cutRegions, transferRegions, regionAt, endGroup, toast } from './store';

const get = useWorld.getState;

/**
 * Smallest piece a cut keeps, as a share of the region: small enough that the slivers between
 * a river and a region border that almost follows it are cut off too, so a claim ends on the river.
 */
const MIN_PIECE = 0.002;

/** Geometries already found to cross no active line, per barrier setting. */
const clean = new WeakMap<RegionGeom, string>();

/** The active setting, or null when natural borders are off or not loaded yet. */
export function activeNatural(): { b: Barriers; o: NaturalOpts } | null {
  const b = barriers();
  const o = get().natural;
  return b && naturalOn(o) ? { b, o } : null;
}

/**
 * Cuts the given regions along every active river and crest that crosses them. Returns the
 * region ids afterwards: pieces in place of the regions that were cut.
 */
export function cutAlongNature(ids: number[], opts: { group?: string; o?: NaturalOpts } = {}): number[] {
  const b = barriers();
  const o = opts.o ?? get().natural;
  if (!b || !naturalOn(o)) return ids;
  const key = Barriers.key(o);
  const geoms = get().geoms;
  const todo = ids.filter((id) => geoms[id] && clean.get(geoms[id]) !== key);
  if (!todo.length) return ids;
  const cut = cutRegions(
    todo,
    (g) => {
      const lines = b.linesIn(bbox(g), o);
      const pieces = lines.length ? cutGeom(g, lines, MIN_PIECE) : null;
      if (!pieces) clean.set(g, key);
      return pieces;
    },
    { label: 'Cut along rivers & crests', group: opts.group, names: 'compass' },
  );
  // The pieces only touch lines along their borders now.
  for (const pids of Object.values(cut)) for (const p of pids) if (get().geoms[p]) clean.set(get().geoms[p], key);
  return ids.flatMap((id) => cut[id] ?? [id]);
}

/** Whether going straight from a to b crosses an active river or crest. */
export function blocked(a: LngLat, b: LngLat): boolean {
  const n = activeNatural();
  return !!n && n.b.crosses(a, b, n.o);
}

/**
 * The regions a brush dab at `center` may take: those under one of the `samples` (points of the
 * dab) that can be reached from the centre without crossing a line, and whose label point can be
 * reached from there too — so a region whose bulk lies across the river stays out even when the
 * river wanders a little inside its border. `dab` is the dab's outline: pieces too thin to hold a
 * sample (slivers along a river) are taken when one of their corners lies inside it, this side.
 */
export function reachable(center: LngLat, samples: LngLat[], ids: number[], dab?: LngLat[]): number[] {
  const n = activeNatural();
  const { doc, geoms } = get();
  if (!doc) return [];
  if (!n) return ids;
  const pts = [center, ...samples.filter((q) => !n.b.crosses(center, q, n.o))];
  const dabBox = dab && bboxOf(dab);
  return ids.filter((id) => {
    const r = doc.regions[id];
    const g = geoms[id];
    if (!r || !g) return false;
    const rep: LngLat = [r.cx, r.cy];
    if (pts.some((q) => pointInGeom(q, g) && !n.b.crosses(q, rep, n.o))) return true;
    if (!dab || !dabBox) return false;
    const box = bbox(g);
    if (box[0] > dabBox[2] || box[2] < dabBox[0] || box[1] > dabBox[3] || box[3] < dabBox[1]) return false;
    const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
    for (const ring of rings)
      for (const v of ring as LngLat[])
        if (inRing(v, dab) && !n.b.crosses(center, v, n.o) && !n.b.crosses(v, rep, n.o)) return true;
    return false;
  });
}

function bboxOf(pts: LngLat[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Point in a closed ring given without its closing point (ray casting). */
function inRing([x, y]: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Takes for `cid` the land of the country under `at`, up to the rivers and crests: the regions
 * of that country reachable from the clicked spot without crossing a line. Only the regions the
 * fill reaches are cut along the lines — the rest of the country stays as it was.
 */
export function claimUpToNature(at: LngLat, cid: string, opts: { group?: string; label?: string } = {}): number {
  const start = regionAt(at);
  if (!get().doc || !start || start.cid === cid) return 0;
  const src = start.cid;
  const n = activeNatural();
  if (!n) {
    const own = Object.values(get().doc!.regions).filter((r) => r.cid === src);
    return transferRegions(own.map((r) => r.id), cid, opts);
  }
  const rep = (id: number): LngLat => {
    const r = get().doc!.regions[id];
    return [r.cx, r.cy];
  };
  // Cut the clicked region, keep the piece under the click.
  cutAlongNature([start.id], { group: opts.group });
  const first = regionAt(at);
  if (!first) return 0;
  const taken = new Set([first.id]);
  const queue = [first.id];
  while (queue.length) {
    const from = queue.shift()!;
    for (const m of engine.neighbors(from)) {
      if (taken.has(m) || get().doc!.regions[m]?.cid !== src) continue;
      // Enter the neighbour through a stretch of shared border this side of every line…
      const entry = engine.sharedPoints(from, m).find((p) => !n.b.crosses(rep(from), p, n.o));
      if (!entry) continue;
      // …then cut it along its own lines and take the pieces reachable from there.
      for (const piece of cutAlongNature([m], { group: opts.group })) {
        if (taken.has(piece) || n.b.crosses(entry, rep(piece), n.o)) continue;
        taken.add(piece);
        queue.push(piece);
      }
    }
  }
  return transferRegions([...taken], cid, opts);
}

/** Lines used to snap a border when the brush's natural borders are off: big rivers and crests. */
const SNAP_DEFAULT: NaturalOpts = { rivers: 'major', crests: true };

/** The lines a snap follows: the brush's setting when it has one, else big rivers and crests. */
export function snapLines(): NaturalOpts {
  const o = get().natural;
  return naturalOn(o) ? o : SNAP_DEFAULT;
}

/** Countries sharing a border with `cid`, longest border first (counted in shared region pairs). */
export function neighbourCountries(cid: string): string[] {
  const doc = get().doc;
  if (!doc || !engine.ready) return [];
  const count = new Map<string, number>();
  for (const r of Object.values(doc.regions)) {
    if (r.cid !== cid) continue;
    for (const m of engine.neighbors(r.id)) {
      const o = doc.regions[m]?.cid;
      if (o && o !== cid && doc.countries[o]) count.set(o, (count.get(o) ?? 0) + 1);
    }
  }
  return [...count.entries()].sort((x, y) => y[1] - x[1]).map(([c]) => c);
}

/** The regions of `a` and `b` that touch each other: where their shared border runs. */
export function borderRegions(a: string, b: string): number[] {
  const doc = get().doc;
  if (!doc || !engine.ready) return [];
  const out: number[] = [];
  for (const r of Object.values(doc.regions)) {
    if (r.cid !== a && r.cid !== b) continue;
    const other = r.cid === a ? b : a;
    if (engine.neighbors(r.id).some((m) => doc.regions[m]?.cid === other)) out.push(r.id);
  }
  return out;
}

/** How far from the current border a river or crest may run and still be followed (degrees, ~30 km). */
const SNAP_REACH = 0.3;

/**
 * Moves the border between countries `a` and `b` onto the rivers and crests running along it:
 * only lines within SNAP_REACH of today's border count (a tributary further inland is not a
 * border). The regions along the border (inside `lasso` when given) are cut along those lines,
 * then every piece the lines cut off from the rest of its own country goes to the neighbour on
 * its side. Land still joined to its country never changes hands. Returns how many pieces moved.
 */
export function snapBorder(a: string, b: string, lasso?: LngLat[]): number {
  const bar = barriers();
  const doc0 = get().doc;
  if (!bar || !doc0 || !engine.ready || a === b) return 0;
  const o = snapLines();
  const group = `snap:${Date.now()}`;
  const pair = new Set([a, b]);
  const owner = (id: number) => get().doc!.regions[id]?.cid;
  const lassoBox = lasso && bboxOf(lasso);
  const inLasso = (id: number) => {
    if (!lasso || !lassoBox) return true;
    const g = get().geoms[id];
    const r = get().doc!.regions[id];
    if (!g || !r) return false;
    if (inRing([r.cx, r.cy], lasso)) return true;
    const box = bbox(g);
    if (box[0] > lassoBox[2] || box[2] < lassoBox[0] || box[1] > lassoBox[3] || box[3] < lassoBox[1]) return false;
    const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
    return rings.some((ring) => (ring as LngLat[]).some((v) => inRing(v, lasso)));
  };

  // Today's border (the stretch inside the lasso), indexed to find what runs near it.
  const near = new Map<number, LngLat[]>();
  const key = (x: number, y: number) => Math.floor(x / SNAP_REACH) * 100000 + Math.floor(y / SNAP_REACH);
  for (const arc of engine.arcsBetween((r) => owner(r) === a, (r) => owner(r) === b))
    for (const v of arc) {
      if (lasso && !inRing(v, lasso)) continue;
      const k = key(v[0], v[1]);
      const list = near.get(k);
      if (list) list.push(v);
      else near.set(k, [v]);
    }
  if (!near.size) return 0;
  const isNear = (p: LngLat) => {
    const cx = Math.floor(p[0] / SNAP_REACH);
    const cy = Math.floor(p[1] / SNAP_REACH);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const v of near.get((cx + dx) * 100000 + cy + dy) ?? []) if (Math.hypot(v[0] - p[0], v[1] - p[1]) <= SNAP_REACH) return true;
    return false;
  };
  // The followed lines: the stretches of active lines near the border.
  const kept: [LngLat, LngLat][] = [];
  const nearLines = (box: [number, number, number, number]) => {
    const out: LngLat[][] = [];
    for (const run of bar.linesIn(box, o)) {
      let cur: LngLat[] = [];
      for (const v of run) {
        if (isNear(v)) cur.push(v);
        else {
          if (cur.length > 1) out.push(cur);
          cur = [];
        }
      }
      if (cur.length > 1) out.push(cur);
    }
    return out;
  };

  // The zone: the two countries' regions along their shared border, and the row behind them
  // (a river often runs a region or so away from today's border).
  const zone = new Set<number>();
  for (const r of Object.values(doc0.regions)) {
    if (!pair.has(r.cid)) continue;
    const other = r.cid === a ? b : a;
    if (engine.neighbors(r.id).some((m) => owner(m) === other) && inLasso(r.id)) zone.add(r.id);
  }
  if (!zone.size) return 0;
  for (const id of [...zone]) for (const m of engine.neighbors(id)) if (pair.has(owner(m) ?? '') && inLasso(m)) zone.add(m);

  const cut = cutRegions(
    [...zone],
    (g) => {
      const lines = nearLines(bbox(g));
      for (const l of lines) for (let i = 0; i + 1 < l.length; i++) kept.push([l[i], l[i + 1]]);
      return lines.length ? cutGeom(g, lines, MIN_PIECE) : null;
    },
    { label: `Cut along rivers & crests`, group, names: 'compass' },
  );
  const pieces = new Set([...zone].flatMap((id) => cut[id] ?? [id]));
  const doc = get().doc!;
  // Two regions are joined when part of the border they share does not run along a followed
  // line: the cuts put every piece's edge exactly on the river or crest that made it.
  const onKept = (p: LngLat) => kept.some(([u, v]) => segDist(p, u, v) <= 1e-6);
  const passes = (from: number, to: number) => engine.sharedPoints(from, to).some((p) => !onKept(p));

  // Pieces still joined to the rest of their own country.
  const joined = new Set<number>();
  for (const cid of pair) {
    const own = [...pieces].filter((id) => doc.regions[id]?.cid === cid);
    const queue: number[] = [];
    for (const id of own)
      for (const m of engine.neighbors(id))
        if (!pieces.has(m) && doc.regions[m]?.cid === cid && passes(m, id)) {
          joined.add(id);
          queue.push(id);
          break;
        }
    // A country lying entirely in the zone has nothing to be cut off from: leave it be.
    if (!queue.length) own.forEach((id) => joined.add(id));
    while (queue.length) {
      const from = queue.shift()!;
      for (const m of engine.neighbors(from))
        if (pieces.has(m) && !joined.has(m) && doc.regions[m]?.cid === cid && passes(from, m)) {
          joined.add(m);
          queue.push(m);
        }
    }
  }

  // Cut-off pieces go to the country whose firm land reaches them first without crossing a
  // followed line, spreading outward from both countries at once. A scrap reached by neither
  // (walled in by lines on every side) stays as it is.
  const reached = new Map<number, string>();
  const queue: [number, string][] = [];
  for (const id of pieces) if (joined.has(id)) queue.push([id, doc.regions[id].cid]);
  for (const id of pieces)
    for (const m of engine.neighbors(id)) if (!pieces.has(m) && pair.has(doc.regions[m]?.cid ?? '')) queue.push([m, doc.regions[m].cid]);
  for (let i = 0; i < queue.length; i++) {
    const [from, cid] = queue[i];
    for (const m of engine.neighbors(from)) {
      if (!pieces.has(m) || joined.has(m) || reached.has(m) || !passes(from, m)) continue;
      reached.set(m, cid);
      queue.push([m, cid]);
    }
  }
  const moves = new Map([...reached].filter(([id, cid]) => doc.regions[id]?.cid !== cid));
  const name = (c: string) => doc.countries[c]?.name ?? c;
  const toA = [...moves].filter(([, c]) => c === a).map(([id]) => id);
  const toB = [...moves].filter(([, c]) => c === b).map(([id]) => id);
  const label = `Snap ${name(a)} – ${name(b)} border`;
  if (toA.length) transferRegions(toA, a, { group, label });
  if (toB.length) transferRegions(toB, b, { group, label });
  endGroup();
  return moves.size;
}

/** Distance from p to the segment u-v, in degrees. */
function segDist(p: LngLat, u: LngLat, v: LngLat): number {
  const dx = v[0] - u[0];
  const dy = v[1] - u[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - u[0] - t * dx, p[1] - u[1] - t * dy);
}

/** Snaps the border chosen in the snap card, along its whole length or inside `lasso`. */
export async function runSnap(lasso?: LngLat[]) {
  const s = get().snap;
  if (!s?.other) return;
  try {
    await loadBarriers();
  } catch {
    toast('Could not load the rivers and crests', 'error');
    return;
  }
  const n = snapBorder(s.cid, s.other, lasso);
  const doc = get().doc;
  const names = `${doc?.countries[s.cid]?.name} and ${doc?.countries[s.other]?.name}`;
  if (n) {
    toast(`Border between ${names} now follows the rivers & crests · ${n} piece${n > 1 ? 's' : ''} of land changed hands`, 'ok');
    useWorld.setState({ snap: null });
  } else {
    toast(lasso ? 'Nothing to snap there: no river or crest cuts land off along that stretch' : `Nothing to snap: no river or crest cuts land off along the ${names} border`);
    if (lasso) useWorld.setState({ snap: { ...s, drawing: false } });
  }
}

/** The loop drawn on the map: snaps the part of the border inside it. */
export function finishSnapLasso(pts: LngLat[]) {
  if (pts.length < 6) {
    toast('Draw a loop around the stretch of border to snap');
    return;
  }
  void runSnap(pts);
}
