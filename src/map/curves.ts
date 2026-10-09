// Curved country names: a gentle arc along the length of a country, for the name to follow
// (the atlas look). Only elongated countries get one; round ones keep a straight name.
import type { LineString, MultiPolygon, Position } from 'geojson';
import type { LngLat } from '../types';

const D = Math.PI / 180;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * D) / 2)) / D;
const unmercY = (y: number) => (2 * Math.atan(Math.exp(y * D)) - Math.PI / 2) / D;

/** Points spaced evenly along a ring (vertex density would otherwise bias the fit). */
function resample(ring: Position[], n: number): [number, number][] {
  const pts = ring.map((p) => [p[0], mercY(p[1])] as [number, number]);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (!len) return pts;
  const step = len / n;
  const out: [number, number][] = [];
  let walked = 0;
  let next = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const seg = Math.hypot(bx - ax, by - ay);
    while (seg > 0 && next <= walked + seg) {
      const t = (next - walked) / seg;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      next += step;
    }
    walked += seg;
  }
  return out;
}

/**
 * The arc for a country shaped `shape` (its main body), or null when it is too round for a
 * curve to help. `through` makes the arc pass by a hand-placed label.
 */
export function countryCurve(shape: MultiPolygon | null, through?: LngLat): LineString | null {
  if (!shape?.coordinates.length) return null;
  // The largest polygon's outline.
  let best: Position[] | null = null;
  let bestA = 0;
  for (const poly of shape.coordinates) {
    const r = poly[0];
    let a = 0;
    for (let i = 1; i < r.length; i++) a += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1];
    if (Math.abs(a) > bestA) {
      bestA = Math.abs(a);
      best = r;
    }
  }
  if (!best || best.length < 4) return null;
  // Crossing the antimeridian: not worth the trouble.
  const xs = best.map((p) => p[0]);
  if (Math.max(...xs) - Math.min(...xs) > 180) return null;
  const pts = resample(best, 160);
  const n = pts.length;
  const mx = pts.reduce((t, p) => t + p[0], 0) / n;
  const my = pts.reduce((t, p) => t + p[1], 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  // Principal axis; names read along it, so keep it within ±60° of horizontal.
  let ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const l1 = (sxx + syy) / 2 + Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
  const l2 = (sxx + syy) / 2 - Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
  const elong = Math.sqrt(l1 / Math.max(l2, 1e-12));
  if (elong < 1.45) return null;
  if (Math.abs(ang) > Math.PI / 3) ang = Math.sign(ang) * (Math.PI / 3);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const toLocal = ([x, y]: [number, number]) => [(x - mx) * c + (y - my) * s, -(x - mx) * s + (y - my) * c] as [number, number];
  const fromLocal = ([u, v]: [number, number]) => [mx + u * c - v * s, my + u * s + v * c] as [number, number];
  const loc = pts.map(toLocal);
  const us = loc.map((p) => p[0]);
  const u0 = Math.min(...us);
  const u1 = Math.max(...us);
  // Middle of the shape across, in slices along its length.
  const bins = 12;
  const mids: [number, number, number][] = [];
  for (let b = 0; b < bins; b++) {
    const a = u0 + ((u1 - u0) * b) / bins;
    const z = u0 + ((u1 - u0) * (b + 1)) / bins;
    const vs = loc.filter((p) => p[0] >= a && p[0] <= z).map((p) => p[1]);
    if (vs.length < 2) continue;
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    mids.push([(a + z) / 2, (lo + hi) / 2, hi - lo]);
  }
  if (mids.length < 3) return null;
  // Least squares parabola v = k2 u² + k1 u + k0, weighted by the slice's thickness.
  const A = [0, 0, 0, 0, 0];
  const B = [0, 0, 0];
  for (const [u, v, w] of mids) {
    for (let k = 0; k < 5; k++) A[k] += w * u ** k;
    for (let k = 0; k < 3; k++) B[k] += w * v * u ** k;
  }
  const M = [
    [A[0], A[1], A[2]],
    [A[1], A[2], A[3]],
    [A[2], A[3], A[4]],
  ];
  const k = solve3(M, B);
  if (!k) return null;
  // Keep the bend gentle: at most a fifth of the length off straight.
  const half = (u1 - u0) / 2;
  const um = (u0 + u1) / 2;
  const maxBend = (u1 - u0) / 5;
  const bend = Math.abs(k[2]) * half * half;
  if (bend > maxBend) k[2] *= maxBend / bend;
  let shift = 0;
  if (through) {
    const [tu, tv] = toLocal([through[0], mercY(through[1])]);
    shift = tv - (k[2] * tu * tu + k[1] * tu + k[0]);
  }
  const line: Position[] = [];
  const from = um - half * 0.8;
  const to = um + half * 0.8;
  for (let i = 0; i <= 24; i++) {
    const u = from + ((to - from) * i) / 24;
    const [x, y] = fromLocal([u, k[2] * u * u + k[1] * u + k[0] + shift]);
    line.push([+x.toFixed(4), +unmercY(y).toFixed(4)]);
  }
  // Left to right, so the name reads the right way.
  if (line[0][0] > line[line.length - 1][0]) line.reverse();
  return { type: 'LineString', coordinates: line };
}

function solve3(m: number[][], b: number[]): number[] | null {
  const det = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-18) return null;
  return [0, 1, 2].map((col) => det(m.map((row, i) => row.map((v, j) => (j === col ? b[i] : v)))) / d);
}
