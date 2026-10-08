import type { Position } from 'geojson';
import type { RegionGeom } from '../types';

/**
 * Repairs borders between regions that almost — but not exactly — line up
 * (tiny gaps, overlaps, vertices missing on one side). Such borders can't be
 * shared arcs in the topology, so they show up as stray lines inside countries.
 *
 * 1. vertices closer than `tol` (degrees) are snapped together,
 * 2. a vertex lying within `tol` of another region's edge is inserted into
 *    that edge, so both sides walk through the same points,
 * 3. rings are cleaned (consecutive duplicates, collapsed rings).
 *
 * Returns only the regions whose geometry changed.
 */
export function healGeoms(geoms: Record<number, RegionGeom>, tol = 0.01): Record<number, RegionGeom> {
  type Ring = { rid: number; pts: Position[] };
  const rings: Ring[] = [];
  const shapes: Record<number, Position[][][]> = {};
  for (const [k, g] of Object.entries(geoms)) {
    if (!g) continue;
    const rid = Number(k);
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((p) =>
      p.map((r) => {
        const pts = r.map((c) => [c[0], c[1]] as Position);
        rings.push({ rid, pts });
        return pts;
      }),
    );
    shapes[rid] = polys;
  }

  const t2 = tol * tol;
  const cell = tol;
  const ck = (x: number, y: number) => Math.floor(x / cell) * 1e6 + Math.floor(y / cell);
  const changed = new Set<number>();

  // ── 1. Vertex ↔ vertex snapping (first point seen in a cluster wins) ────────
  // Memoized by exact coordinate so a point shared by two regions always lands in the same place.
  const canon = new Map<number, Position[]>();
  const memo = new Map<string, Position | null>();
  for (const ring of rings) {
    for (let i = 0; i < ring.pts.length; i++) {
      const p = ring.pts[i];
      const mk = `${p[0]},${p[1]}`;
      const known = memo.get(mk);
      if (known !== undefined) {
        if (known) {
          ring.pts[i] = [known[0], known[1]];
          changed.add(ring.rid);
        }
        continue;
      }
      const cx = Math.floor(p[0] / cell);
      const cy = Math.floor(p[1] / cell);
      let best: Position | null = null;
      let bd = t2;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const list = canon.get((cx + dx) * 1e6 + cy + dy);
          if (!list) continue;
          for (const q of list) {
            const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
            if (d <= bd) {
              bd = d;
              best = q;
            }
          }
        }
      if (best && (best[0] !== p[0] || best[1] !== p[1])) {
        memo.set(mk, best);
        ring.pts[i] = [best[0], best[1]];
        changed.add(ring.rid);
      } else {
        memo.set(mk, null);
        const k = ck(p[0], p[1]);
        const list = canon.get(k);
        if (list) list.push(p);
        else canon.set(k, [p]);
      }
    }
  }

  // ── 2. Vertex → edge (T-junctions) ───────────────────────────────────────
  // Works on unique edges so both copies of a shared edge get the same insertions.
  const pk = (p: Position) => `${p[0]},${p[1]}`;
  const sk = (a: Position, b: Position) => {
    const ka = pk(a);
    const kb = pk(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  type Seg = { a: Position; b: Position; owners: Set<number>; add: Position[] };
  const segs = new Map<string, Seg>();
  const verts = new Map<string, { p: Position; owners: Set<number> }>();
  for (const ring of rings) {
    const pts = ring.pts;
    for (let i = 0; i < pts.length; i++) {
      const k = pk(pts[i]);
      const v = verts.get(k);
      if (v) v.owners.add(ring.rid);
      else verts.set(k, { p: pts[i], owners: new Set([ring.rid]) });
      if (i === 0) continue;
      const key = sk(pts[i - 1], pts[i]);
      const s = segs.get(key);
      if (s) s.owners.add(ring.rid);
      else segs.set(key, { a: pts[i - 1], b: pts[i], owners: new Set([ring.rid]), add: [] });
    }
  }

  // Edge index on a coarser grid so long edges don't fill thousands of cells.
  const ecell = Math.max(tol * 4, 0.05);
  const eKey = (ix: number, iy: number) => ix * 1e6 + iy;
  const grid = new Map<number, Seg[]>();
  for (const s of segs.values()) {
    const { a, b } = s;
    const x0 = Math.floor((Math.min(a[0], b[0]) - tol) / ecell);
    const x1 = Math.floor((Math.max(a[0], b[0]) + tol) / ecell);
    const y0 = Math.floor((Math.min(a[1], b[1]) - tol) / ecell);
    const y1 = Math.floor((Math.max(a[1], b[1]) + tol) / ecell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 40000) continue;
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = eKey(x, y);
        const list = grid.get(k);
        if (list) list.push(s);
        else grid.set(k, [s]);
      }
  }

  for (const { p, owners } of verts.values()) {
    const list = grid.get(eKey(Math.floor(p[0] / ecell), Math.floor(p[1] / ecell)));
    if (!list) continue;
    for (const s of list) {
      let mine = false;
      for (const o of owners) if (s.owners.has(o)) mine = true;
      if (mine) continue;
      const { a, b } = s;
      if ((a[0] === p[0] && a[1] === p[1]) || (b[0] === p[0] && b[1] === p[1])) continue;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      if (!l2) continue;
      const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
      if (t <= 0 || t >= 1) continue;
      const d = (a[0] + t * dx - p[0]) ** 2 + (a[1] + t * dy - p[1]) ** 2;
      if (d <= t2) s.add.push(p);
    }
  }

  const byDistFrom = (a: Position) => (u: Position, v: Position) => (u[0] - a[0]) ** 2 + (u[1] - a[1]) ** 2 - ((v[0] - a[0]) ** 2 + (v[1] - a[1]) ** 2);
  for (const ring of rings) {
    const pts = ring.pts;
    let touched = false;
    const full: Position[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const s = segs.get(sk(pts[i - 1], pts[i]));
      if (s?.add.length) {
        for (const q of [...s.add].sort(byDistFrom(pts[i - 1]))) full.push([q[0], q[1]]);
        touched = true;
      }
      full.push(pts[i]);
    }
    if (!touched) continue;
    pts.length = 0;
    pts.push(...full);
    changed.add(ring.rid);
  }

  // ── 3. Rebuild the changed regions ───────────────────────────────────────
  const result: Record<number, RegionGeom> = {};
  for (const rid of changed) {
    const polys: Position[][][] = [];
    for (const poly of shapes[rid]) {
      const clean = poly.map(cleanRing);
      if (!clean[0]) continue; // outer ring collapsed: drop the polygon
      polys.push([clean[0], ...(clean.slice(1).filter(Boolean) as Position[][])]);
    }
    if (!polys.length) continue; // never delete a region outright
    result[rid] = polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
  }
  return result;
}

/** Drops consecutive duplicates and A-B-A spikes; null when fewer than 3 distinct points remain. */
function cleanRing(r: Position[]): Position[] | null {
  const out: Position[] = [];
  for (const p of r) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    if (out.length >= 2) {
      const prev = out[out.length - 2];
      if (prev[0] === p[0] && prev[1] === p[1]) {
        out.pop();
        continue;
      }
    }
    out.push(p);
  }
  // Close the ring.
  if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push([out[0][0], out[0][1]]);
  return out.length >= 4 ? out : null;
}
