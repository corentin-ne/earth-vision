// Whole-world maintenance operations behind the "Advanced" menu. Each one is a single undo step.
import type { City, Country, Region } from '../types';
import { useWorld, commit, engine, countryAggregates, toast } from './store';
import { labelPoint, pointInGeom, bbox } from '../geo/engine';
import { loadEarthData } from '../io/earth';
import { buildPopulationModel, estimatePopulation, type PopulationModel } from './population';
import { distributeByArea } from './stats';
import { randomFlag } from './flagGen';
import { iso2 } from './flags';
import { uid, fmtCompact } from '../util';

const get = useWorld.getState;

/** The population stat of the world (the first scaling stat, preferring one called "Pop…"). */
export function populationKey(): string | null {
  const stats = get().doc?.settings.stats ?? [];
  return (stats.find((s) => s.scale && /^pop/i.test(s.key)) ?? stats.find((s) => s.scale))?.key ?? null;
}

const worldPop = (regions: Region[], key: string) => regions.reduce((s, r) => s + (r.vals?.[key] ?? 0), 0);

let model: Promise<PopulationModel> | null = null;

/**
 * Recomputes every region's population for the current borders.
 * - `real`: from real-world data (density of the land underneath + the cities inside).
 * - `even`: keeps each country's total but spreads it over its land by area.
 */
export async function recalcPopulation(mode: 'real' | 'even'): Promise<string> {
  const doc = get().doc;
  const key = populationKey();
  if (!doc || !key) return 'This world has no population statistic.';
  const list = Object.values(doc.regions);
  const before = worldPop(list, key);
  const regions: Record<number, Region> = {};
  if (mode === 'real') {
    model ??= loadEarthData().then(buildPopulationModel);
    const est = estimatePopulation(list, get().geoms, await model);
    for (const r of list) regions[r.id] = { ...r, vals: { ...r.vals, [key]: est[r.id] ?? 0 } };
  } else {
    const totals: Record<string, Record<string, number>> = {};
    for (const [cid, a] of Object.entries(countryAggregates(doc))) if (cid) totals[cid] = { [key]: a.vals[key] ?? 0 };
    const copy = Object.fromEntries(list.map((r) => [r.id, { ...r, vals: { ...r.vals } }]));
    distributeByArea(copy, totals);
    Object.assign(regions, copy);
  }
  commit(mode === 'real' ? 'Recalculate population' : 'Spread population by area', { regions });
  const after = worldPop(Object.values(regions), key);
  return `${key}: ${fmtCompact(before)} → ${fmtCompact(after)}`;
}

/**
 * Cleans up painting leftovers: pieces of a country cut off from its main territory and
 * entirely surrounded by one other country go to that country; unclaimed holes inside a
 * country are filled. With `countries`, small countries that are completely enclaved go too.
 */
export function tidyBorders(maxArea: number, opts: { countries?: boolean } = {}): number {
  const doc = get().doc;
  if (!doc) return 0;
  const seen = new Set<number>();
  const comps: { cid: string; ids: number[]; area: number; around: Set<string> }[] = [];
  for (const r of Object.values(doc.regions)) {
    if (seen.has(r.id)) continue;
    const ids: number[] = [];
    const around = new Set<string>();
    const stack = [r.id];
    seen.add(r.id);
    let area = 0;
    let isolated = true;
    while (stack.length) {
      const id = stack.pop()!;
      ids.push(id);
      area += doc.regions[id].area;
      for (const nb of engine.neighbors(id)) {
        const o = doc.regions[nb];
        if (!o) continue;
        isolated = false;
        if (o.cid === r.cid) {
          if (!seen.has(nb)) {
            seen.add(nb);
            stack.push(nb);
          }
        } else around.add(o.cid);
      }
    }
    if (!isolated) comps.push({ cid: r.cid, ids, area, around });
  }
  // The largest piece of each country is its heartland and never moves (unless enclaved countries are allowed to).
  const main: Record<string, number> = {};
  for (const c of comps) main[c.cid] = Math.max(main[c.cid] ?? 0, c.area);
  const regions: Record<number, Region> = {};
  let moved = 0;
  for (const c of comps) {
    if (c.around.size !== 1 || c.area > maxArea) continue;
    const [to] = c.around;
    if (!to) continue; // surrounded by unclaimed land: nothing to heal into
    const fragment = c.cid === '' || c.area < main[c.cid] || (opts.countries && c.area === main[c.cid] && comps.filter((x) => x.cid === c.cid).length === 1);
    if (!fragment) continue;
    for (const id of c.ids) regions[id] = { ...doc.regions[id], cid: to };
    moved += c.ids.length;
  }
  if (moved) commit(`Tidy stray pieces (${moved} region${moved > 1 ? 's' : ''})`, { regions });
  return moved;
}

/** Re-colours every country from the palette so that no two neighbours share a colour. */
export function autoColor(): void {
  const doc = get().doc;
  if (!doc) return;
  const adj: Record<string, Set<string>> = {};
  for (const r of Object.values(doc.regions)) {
    if (!r.cid) continue;
    const a = (adj[r.cid] ??= new Set());
    for (const nb of engine.neighbors(r.id)) {
      const o = doc.regions[nb]?.cid;
      if (o && o !== r.cid) a.add(o);
    }
  }
  const palette = doc.settings.palette.length ? doc.settings.palette : ['#D6C7FF', '#EBCA8A', '#C1E599', '#E7E58F', '#98DDA1', '#83D5F4'];
  const color: Record<string, string> = {};
  const usage: Record<string, number> = {};
  // Most-connected first (classic greedy colouring); among free colours take the least used, for variety.
  for (const cid of Object.keys(adj).sort((a, b) => adj[b].size - adj[a].size)) {
    const near = new Set([...adj[cid]].map((n) => color[n]));
    const free = palette.filter((c) => !near.has(c));
    const pool = free.length ? free : palette;
    const c = pool.reduce((best, x) => ((usage[x] ?? 0) < (usage[best] ?? 0) ? x : best), pool[0]);
    color[cid] = c;
    usage[c] = (usage[c] ?? 0) + 1;
  }
  const countries: Record<string, Country> = {};
  for (const [cid, c] of Object.entries(color)) if (doc.countries[cid] && doc.countries[cid].color !== c) countries[cid] = { ...doc.countries[cid], color: c };
  commit('Recolour the map', { countries });
}

/** Gives every country without a capital its biggest city inside its borders. */
export function assignCapitals(): number {
  const doc = get().doc;
  if (!doc) return 0;
  const owner = cityOwners();
  const best: Record<string, City> = {};
  for (const c of Object.values(doc.cities)) {
    const cid = owner[c.id];
    if (!cid || doc.countries[cid]?.capital != null) continue;
    if (!best[cid] || (c.pop ?? 0) > (best[cid].pop ?? 0)) best[cid] = c;
  }
  const countries: Record<string, Country> = {};
  const cities: Record<number, City> = {};
  for (const [cid, c] of Object.entries(best)) {
    countries[cid] = { ...doc.countries[cid], capital: c.id };
    cities[c.id] = { ...c, capital: true };
  }
  const n = Object.keys(countries).length;
  if (n) commit(`Choose ${n} capital${n > 1 ? 's' : ''}`, { countries, cities });
  return n;
}

/** Country of each city, from where it stands. */
function cityOwners(): Record<number, string> {
  const { doc, geoms } = get();
  const out: Record<number, string> = {};
  if (!doc) return out;
  const boxes = Object.values(doc.regions)
    .filter((r) => geoms[r.id])
    .map((r) => [r, bbox(geoms[r.id])] as const);
  for (const c of Object.values(doc.cities)) {
    const hit = boxes.find(([r, b]) => c.lng >= b[0] && c.lng <= b[2] && c.lat >= b[1] && c.lat <= b[3] && pointInGeom([c.lng, c.lat], geoms[r.id]));
    if (hit?.[0].cid) out[c.id] = hit[0].cid;
  }
  return out;
}

/** Removes countries that own no land any more. */
export function removeEmptyCountries(): number {
  const doc = get().doc;
  if (!doc) return 0;
  const agg = countryAggregates(doc);
  const gone = Object.keys(doc.countries).filter((cid) => !agg[cid]?.regions);
  if (gone.length) commit(`Remove ${gone.length} empty countr${gone.length > 1 ? 'ies' : 'y'}`, { countries: Object.fromEntries(gone.map((cid) => [cid, null])) });
  return gone.length;
}

/** Puts every country name back at the visual centre of its land. */
export function recenterLabels(): void {
  const doc = get().doc;
  if (!doc) return;
  const ids: Record<string, number[]> = {};
  for (const r of Object.values(doc.regions)) if (r.cid) (ids[r.cid] ??= []).push(r.id);
  const countries: Record<string, Country> = {};
  for (const [cid, list] of Object.entries(ids)) {
    const c = doc.countries[cid];
    const lp = c && labelPoint(engine.merge(list));
    if (lp) countries[cid] = { ...c, label: lp };
  }
  commit('Re-centre country names', { countries });
}

/** Draws a flag for every country that has none (neither uploaded nor a real-world one). */
export async function flagsForAll(): Promise<number> {
  const s = get();
  const doc = s.doc;
  if (!doc) return 0;
  const todo = Object.values(doc.countries).filter((c) => !(c.flag && s.flags[c.flag]) && !iso2[c.cid]);
  const blobs = await Promise.all(todo.map((c) => randomFlag(c.color)));
  const flags = { ...get().flags };
  const flagUrls = { ...get().flagUrls };
  const countries: Record<string, Country> = {};
  todo.forEach((c, i) => {
    const blob = blobs[i];
    if (!blob) return;
    const key = `${c.cid}-${uid().slice(0, 8)}`;
    flags[key] = blob;
    flagUrls[key] = URL.createObjectURL(blob);
    countries[c.cid] = { ...c, flag: key };
  });
  const n = Object.keys(countries).length;
  if (!n) return 0;
  useWorld.setState({ flags, flagUrls });
  commit(`Draw ${n} flag${n > 1 ? 's' : ''}`, { countries });
  return n;
}

/** Runs an operation and reports its outcome as a toast. */
export async function runAdvanced(fn: () => unknown | Promise<unknown>, done: (r: unknown) => string) {
  try {
    toast(done(await fn()), 'ok');
  } catch (e) {
    console.error(e);
    toast('Failed: ' + (e as Error).message, 'error');
  }
}
