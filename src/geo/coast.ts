// Snapping the regions' coasts onto a detailed coastline.
//
// The regions come with simplified outlines. Where an outline runs along the sea (an edge no
// other region shares), that stretch is replaced by the real coastline between the same two
// ends. The points where borders between regions reach the coast stay where they are, so every
// region changes on its own and neighbours still fit point for point.
import type { Position } from 'geojson';
import type { LngLat, RegionGeom } from '../types';
import { geomIssues } from './repair';

const CELL = 0.5; // degrees

export interface CoastData {
  scale: number;
  /** Rings as delta-encoded points: dx, dy, dx, dy… in 1/scale degrees. */
  rings: number[][];
}

interface Hit {
  ring: number;
  /** Position along the ring: segment index + fraction. */
  t: number;
  pt: LngLat;
  d: number;
}

/** The detailed coastline: closed rings, with a grid to find the nearest stretch fast. */
export class Coastline {
  readonly rings: LngLat[][] = [];
  private grid = new Map<number, number[]>();
  private segRing: Int32Array;
  private segIdx: Int32Array;

  constructor(data: CoastData | LngLat[][]) {
    if (Array.isArray(data)) this.rings = data.map((r) => (same(r[0], r[r.length - 1]) ? r.slice(0, -1) : r));
    else
      for (const flat of data.rings) {
        const ring: LngLat[] = [];
        let x = 0;
        let y = 0;
        for (let i = 0; i + 1 < flat.length; i += 2) {
          x += flat[i];
          y += flat[i + 1];
          ring.push([x / data.scale, y / data.scale]);
        }
        // Stored closed: drop the repeated first point.
        if (ring.length > 3 && same(ring[0], ring[ring.length - 1])) ring.pop();
        if (ring.length >= 3) this.rings.push(ring);
      }
    let n = 0;
    for (const r of this.rings) n += r.length;
    this.segRing = new Int32Array(n);
    this.segIdx = new Int32Array(n);
    let s = 0;
    this.rings.forEach((r, ri) => {
      for (let i = 0; i < r.length; i++, s++) {
        this.segRing[s] = ri;
        this.segIdx[s] = i;
        const a = r[i];
        const b = r[(i + 1) % r.length];
        for (let cx = Math.floor(Math.min(a[0], b[0]) / CELL); cx <= Math.floor(Math.max(a[0], b[0]) / CELL); cx++)
          for (let cy = Math.floor(Math.min(a[1], b[1]) / CELL); cy <= Math.floor(Math.max(a[1], b[1]) / CELL); cy++) {
            const k = cx * 4096 + cy;
            const list = this.grid.get(k);
            if (list) list.push(s);
            else this.grid.set(k, [s]);
          }
      }
    });
  }

  /** The nearest point of the coastline within `tol` degrees (on ring `only`, if given). */
  nearest(p: LngLat, tol: number, only?: number): Hit | null {
    let best: Hit | null = null;
    for (let cx = Math.floor((p[0] - tol) / CELL); cx <= Math.floor((p[0] + tol) / CELL); cx++)
      for (let cy = Math.floor((p[1] - tol) / CELL); cy <= Math.floor((p[1] + tol) / CELL); cy++)
        for (const s of this.grid.get(cx * 4096 + cy) ?? []) {
          const ri = this.segRing[s];
          if (only != null && ri !== only) continue;
          const r = this.rings[ri];
          const i = this.segIdx[s];
          const a = r[i];
          const b = r[(i + 1) % r.length];
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const len = dx * dx + dy * dy;
          const u = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
          const q: LngLat = [a[0] + u * dx, a[1] + u * dy];
          const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
          if (d <= tol && (!best || d < best.d)) best = { ring: ri, t: i + u, pt: q, d };
        }
    return best;
  }

  /** The coastline's own points strictly between two positions on a ring, walking forward (or backward). */
  between(ring: number, from: number, to: number, forward: boolean): LngLat[] {
    const r = this.rings[ring];
    const n = r.length;
    const out: LngLat[] = [];
    if (forward) {
      let i = Math.floor(from) + 1;
      const end = to >= from ? Math.floor(to) : Math.floor(to) + n;
      for (; i <= end; i++) out.push(r[i % n]);
    } else {
      let i = Math.ceil(from) - 1;
      const end = to <= from ? Math.ceil(to) : Math.ceil(to) - n;
      for (; i >= end; i--) out.push(r[((i % n) + n) % n]);
    }
    // The ends themselves are added by the caller.
    return out.filter((p, k, a) => k === 0 || !same(p, a[k - 1]));
  }

  /** How far forward along the ring `to` is from `from`, as a share of the ring (0–1). */
  span(ring: number, from: number, to: number): number {
    const n = this.rings[ring].length;
    return (((to - from) % n) + n) % n / n;
  }
}

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
const ekey = (a: Position, b: Position) => {
  const ka = `${a[0]},${a[1]}`;
  const kb = `${b[0]},${b[1]}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

function ringArea(r: Position[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
}

/**
 * Regions whose coast was moved onto the coastline, with their new shapes. `only` limits the
 * work to some regions (every region still counts to tell coast from inland borders); `tol` is
 * how far (degrees) a coast may be from the real one and still be taken for it.
 */
export function snapCoasts(geoms: Record<number, RegionGeom>, coast: Coastline, only?: Set<number>, tol = 0.35): Record<number, RegionGeom> {
  // An edge used once is coast; an edge two regions share is a border.
  const uses = new Map<string, number>();
  const each = (g: RegionGeom, fn: (ring: Position[]) => void) => {
    for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) for (const ring of poly) fn(ring);
  };
  for (const g of Object.values(geoms))
    each(g, (ring) => {
      for (let i = 0; i + 1 < ring.length; i++) {
        const k = ekey(ring[i], ring[i + 1]);
        uses.set(k, (uses.get(k) ?? 0) + 1);
      }
    });
  const isCoast = (a: Position, b: Position) => uses.get(ekey(a, b)) === 1;

  const out: Record<number, RegionGeom> = {};
  for (const [key, g] of Object.entries(geoms)) {
    const id = Number(key);
    if (only && !only.has(id)) continue;
    let changed = false;
    const fix = (ring: Position[]): Position[] => {
      const next = snapRing(ring, isCoast, coast, tol);
      if (next) changed = true;
      return next ?? ring;
    };
    const ng: RegionGeom =
      g.type === 'Polygon' ? { type: 'Polygon', coordinates: g.coordinates.map(fix) } : { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map(fix)) };
    // A shape the new coast would break (a fjord cutting through a border…) keeps its old one.
    if (changed && !geomIssues(ng).length) out[id] = ng;
  }
  return out;
}

/** One ring with its coastal stretches replaced, or null when nothing changes. */
function snapRing(ring: Position[], isCoast: (a: Position, b: Position) => boolean, coast: Coastline, tol: number): Position[] | null {
  const n = ring.length - 1; // closed: last = first
  if (n < 3) return null;
  const coastal: boolean[] = [];
  for (let i = 0; i < n; i++) coastal.push(isCoast(ring[i], ring[i + 1]));
  const area = Math.abs(ringArea(ring));

  // An island (or a lake shore): the whole ring is coast.
  if (coastal.every(Boolean)) {
    const picks = [0, Math.floor(n / 3), Math.floor((2 * n) / 3)].map((i) => coast.nearest(ring[i] as LngLat, tol));
    if (picks.some((h) => !h) || new Set(picks.map((h) => h!.ring)).size !== 1) return null;
    const real = coast.rings[picks[0]!.ring];
    const closed = [...real, real[0]];
    const a = Math.abs(ringArea(closed));
    // The same island, not a bay of the mainland that happens to be near.
    if (a < area * 0.5 || a > area * 2) return null;
    // Keep the ring's direction (outer rings and holes wind opposite ways).
    return Math.sign(ringArea(closed)) === Math.sign(ringArea(ring)) ? closed : closed.reverse();
  }
  if (!coastal.some(Boolean)) return null;

  // Walk the ring from the start of a border stretch, replacing each run of coast edges.
  let start = 0;
  while (coastal[start] || !coastal[(start + n - 1) % n]) start = (start + 1) % n;
  // `start` is the first border edge after a coastal run: begin there.
  const out: Position[] = [];
  let changed = false;
  let i = 0;
  while (i < n) {
    const a = (start + i) % n;
    if (!coastal[a]) {
      out.push(ring[a]);
      i++;
      continue;
    }
    // A run of coast edges from vertex a to vertex b.
    let len = 0;
    while (i + len < n && coastal[(start + i + len) % n]) len++;
    const pts: Position[] = [];
    for (let k = 0; k <= len; k++) pts.push(ring[(start + i + k) % n]);
    const real = len >= 1 ? realStretch(pts as LngLat[], coast, tol) : null;
    out.push(pts[0]);
    if (real) {
      out.push(...real);
      changed = true;
    } else for (let k = 1; k < len; k++) out.push(pts[k]);
    i += len;
  }
  if (!changed) return null;
  out.push(out[0]);
  // Dropped duplicates, and a sanity check: the coast moved, the region did not turn inside out.
  const clean = out.filter((p, k) => k === 0 || !same(p, out[k - 1]));
  const a = Math.abs(ringArea(clean));
  if (clean.length < 4 || a < area * 0.6 || a > area * 1.6 || Math.sign(ringArea(clean)) !== Math.sign(ringArea(ring))) return null;
  return clean;
}

/**
 * The real coastline between the two ends of a simplified coastal stretch (ends excluded), or
 * null when the stretch does not follow a single coastline closely enough.
 */
function realStretch(pts: LngLat[], coast: Coastline, tol: number): LngLat[] | null {
  const a = coast.nearest(pts[0], tol);
  if (!a) return null;
  const b = coast.nearest(pts[pts.length - 1], tol, a.ring);
  if (!b) return null;
  // Which way round the ring: the way that passes by the middle of the stretch.
  let forward: boolean;
  if (pts.length > 2) {
    const m = coast.nearest(pts[Math.floor(pts.length / 2)], tol, a.ring);
    if (!m) return null;
    forward = coast.span(a.ring, a.t, m.t) <= coast.span(a.ring, a.t, b.t);
  } else forward = coast.span(a.ring, a.t, b.t) <= 0.5;
  const share = forward ? coast.span(a.ring, a.t, b.t) : coast.span(a.ring, b.t, a.t);
  // A stretch never runs most of the way round a continent: that is the wrong way round.
  if (share > 0.6 && coast.rings[a.ring].length > 40) return null;
  const inner = coast.between(a.ring, a.t, b.t, forward);
  // Too long a detour for the stretch it replaces (the ends landed on two sides of a peninsula).
  let was = 0;
  for (let i = 1; i < pts.length; i++) was += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const path = [a.pt, ...inner, b.pt];
  let now = 0;
  for (let i = 1; i < path.length; i++) now += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  if (now > was * 6 + tol * 2) return null;
  return path.filter((p, k) => !(same(p, pts[0]) || same(p, pts[pts.length - 1])) && (k === 0 || !same(p, path[k - 1])));
}

let loaded: Promise<Coastline> | null = null;
/** The bundled coastline (loaded on first use). */
export function loadCoastline(): Promise<Coastline> {
  loaded ??= fetch(new URL('data/coast.json', document.baseURI))
    .then((r) => r.json() as Promise<CoastData>)
    .then((d) => new Coastline(d));
  loaded.catch(() => (loaded = null));
  return loaded;
}
