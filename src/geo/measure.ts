import area from '@turf/area';
import type { LngLat } from '../types';

const R = 6371.0088;
const rad = Math.PI / 180;

/** Great-circle distance in km. */
export function distanceKm(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Length of a path in km. */
export function pathLength(pts: readonly LngLat[]): number {
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += distanceKm(pts[i - 1], pts[i]);
  return km;
}

/** Area in km² of the shape the points enclose (closed back to the first one). */
export function ringArea(pts: readonly LngLat[]): number {
  if (pts.length < 3) return 0;
  return area({ type: 'Polygon', coordinates: [[...pts, pts[0]]] }) / 1e6;
}
