import type { Region } from '../types';

/**
 * Spreads country-level totals of scaling stats (e.g. population) over the
 * country's regions in proportion to their area, so the numbers travel with
 * the land when regions change hands.
 */
export function distributeByArea(regions: Record<number, Region>, totals: Record<string, Record<string, number>>) {
  const areaOf: Record<string, number> = {};
  for (const r of Object.values(regions)) if (r.cid) areaOf[r.cid] = (areaOf[r.cid] ?? 0) + r.area;
  for (const r of Object.values(regions)) {
    const t = totals[r.cid];
    if (!t) continue;
    const share = areaOf[r.cid] ? r.area / areaOf[r.cid] : 0;
    for (const [k, v] of Object.entries(t)) {
      if (!v) continue;
      (r.vals ??= {})[k] = v * share;
    }
  }
}

/**
 * New per-region values when a country's total for a scaling stat is set:
 * keeps the current distribution when there is one, otherwise spreads by area.
 */
export function rescale(regions: Region[], key: string, total: number): Region[] {
  const cur = regions.reduce((s, r) => s + (r.vals?.[key] ?? 0), 0);
  const area = regions.reduce((s, r) => s + r.area, 0);
  return regions.map((r) => {
    const share = cur > 0 ? (r.vals?.[key] ?? 0) / cur : area > 0 ? r.area / area : 1 / regions.length;
    return { ...r, vals: { ...r.vals, [key]: total * share } };
  });
}
