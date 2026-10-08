// Claiming land up to natural borders: regions crossed by an active river or crest are cut
// along it, and the brush / fill never reaches across one.
import type { LngLat, RegionGeom } from '../types';
import { Barriers, barriers, naturalOn, type NaturalOpts } from '../geo/barriers';
import { bbox, pointInGeom } from '../geo/engine';
import { cutGeom } from '../geo/split';
import { useWorld, engine, cutRegions, transferRegions, regionAt } from './store';

const get = useWorld.getState;

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
      const pieces = lines.length ? cutGeom(g, lines) : null;
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
 * river wanders a little inside its border.
 */
export function reachable(center: LngLat, samples: LngLat[], ids: number[]): number[] {
  const n = activeNatural();
  const { doc, geoms } = get();
  if (!doc) return [];
  if (!n) return ids;
  const pts = [center, ...samples.filter((q) => !n.b.crosses(center, q, n.o))];
  return ids.filter((id) => {
    const r = doc.regions[id];
    const g = geoms[id];
    if (!r || !g) return false;
    const rep: LngLat = [r.cx, r.cy];
    return pts.some((q) => pointInGeom(q, g) && !n.b.crosses(q, rep, n.o));
  });
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
