// Cities through history: population figures from 3700 BC to AD 2000 for ~1,700 cities
// (Reba, Reitsma & Seto 2016, after Chandler and Modelski; CC BY 4.0), in
// public/data/cities-history.json. A world can take the figures of a given year — updating its
// cities' populations, adding the cities of that time it lacks, or both — as one undo step.
import type { City } from '../types';
import { commit, useWorld } from './store';

interface HistCity {
  n: string;
  c: string;
  lng: number;
  lat: number;
  /** Year (as a string) → population. */
  p: Record<string, number>;
}
interface HistData {
  years: number[];
  cities: HistCity[];
}

let data: Promise<HistData> | null = null;
export function loadCityHistory(): Promise<HistData> {
  data ??= fetch(new URL('data/cities-history.json', document.baseURI)).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  data.catch(() => (data = null));
  return data;
}

/**
 * A city's population in `year`: the latest figure at or before it, if that figure is recent
 * enough to still say something (within `maxAge` years; figures are sparse in antiquity).
 */
export function popAt(c: Pick<HistCity, 'p'>, year: number, maxAge = year < 1000 ? 400 : year < 1800 ? 150 : 60): number | null {
  let best: number | null = null;
  let bestYear = -Infinity;
  for (const [k, v] of Object.entries(c.p)) {
    const y = Number(k);
    if (y <= year && y > bestYear) [best, bestYear] = [v, y];
  }
  return best != null && year - bestYear <= maxAge ? best : null;
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

/** The city of the world a historical city is: the same name nearby, or anything very close. */
function match(h: HistCity, cities: City[]): City | null {
  let best: City | null = null;
  let bestD = Infinity;
  const name = norm(h.n);
  for (const c of cities) {
    const d = Math.hypot((c.lng - h.lng) * Math.cos((h.lat * Math.PI) / 180), c.lat - h.lat);
    const same = norm(c.name) === name;
    if ((same && d < 1.5) || d < 0.25) {
      // A name match beats a closer stranger.
      const score = same ? d : d + 10;
      if (score < bestD) [best, bestD] = [c, score];
    }
  }
  return best;
}

export interface CityHistoryResult {
  updated: number;
  added: number;
}

/** Applies the figures of `year`: `update` sets the populations of matching cities, `add` founds the missing ones. */
export async function applyCityHistory(year: number, opts: { update: boolean; add: boolean }): Promise<CityHistoryResult> {
  const doc = useWorld.getState().doc;
  if (!doc) return { updated: 0, added: 0 };
  const hist = await loadCityHistory();
  const list = Object.values(doc.cities);
  const patch: Record<number, City> = {};
  let nextId = Math.max(-1, ...list.map((c) => c.id)) + 1;
  let updated = 0;
  let added = 0;
  for (const h of hist.cities) {
    const pop = popAt(h, year);
    if (pop == null) continue;
    const c = match(h, list);
    if (c) {
      if (opts.update && c.pop !== pop) {
        patch[c.id] = { ...c, pop };
        updated++;
      }
    } else if (opts.add) {
      const city: City = { id: nextId++, name: h.n, lng: h.lng, lat: h.lat, capital: false, pop };
      patch[city.id] = city;
      list.push(city);
      added++;
    }
  }
  if (updated || added) commit(`Cities as they were in ${fmtYear(year)}`, { cities: patch });
  return { updated, added };
}

export const fmtYear = (y: number) => (y < 0 ? `${-y} BC` : String(y));
