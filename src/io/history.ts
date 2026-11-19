// "Historical Earth": today's regions dealt out to the states of a year in the past, from the
// open historical-basemaps dataset (A. Ourednik, GPL-3.0). Each map is downloaded once, then
// kept in the browser's cache so the same era opens offline afterwards.
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { Country, Region, RegionGeom, WorldBundle } from '../types';
import { GeoEngine, bbox, pointInGeom } from '../geo/engine';
import { fetchCached } from '../map/overlays';
import { PALETTE, loadEarthData } from './earth';
import { uid } from '../util';

export interface Era {
  /** File suffix in the dataset: `world_<file>.geojson`. */
  file: string;
  year: string;
  label: string;
}

/** The eras offered, oldest first, each with what makes it worth starting from. */
export const ERAS: Era[] = [
  { file: 'bc323', year: '323 BC', label: 'Alexander’s empire' },
  { file: 'bc1', year: '1 BC', label: 'Rome and the Han' },
  { file: '400', year: '400', label: 'Late Roman Empire' },
  { file: '800', year: '800', label: 'Charlemagne and the Abbasids' },
  { file: '1100', year: '1100', label: 'The Crusades begin' },
  { file: '1279', year: '1279', label: 'The Mongol Empire' },
  { file: '1492', year: '1492', label: 'Before the Americas meet Europe' },
  { file: '1650', year: '1650', label: 'After Westphalia' },
  { file: '1715', year: '1715', label: 'Louis XIV’s Europe' },
  { file: '1783', year: '1783', label: 'American independence' },
  { file: '1815', year: '1815', label: 'Congress of Vienna' },
  { file: '1880', year: '1880', label: 'Scramble for Africa' },
  { file: '1914', year: '1914', label: 'Eve of the Great War' },
  { file: '1920', year: '1920', label: 'After Versailles' },
  { file: '1938', year: '1938', label: 'Eve of the Second World War' },
  { file: '1945', year: '1945', label: 'End of the Second World War' },
  { file: '1960', year: '1960', label: 'Decolonisation' },
  { file: '1994', year: '1994', label: 'After the Cold War' },
];

const url = (e: Era) => `https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/world_${e.file}.geojson`;

interface Polity {
  name: string;
  /** Who it answers to (a colony's metropole), when not itself. */
  subjectOf?: string;
  geom: RegionGeom;
  box: [number, number, number, number];
}

function polities(fc: FeatureCollection): Polity[] {
  const out: Polity[] = [];
  for (const f of fc.features as Feature<Polygon | MultiPolygon, Record<string, unknown>>[]) {
    const name = String(f.properties?.NAME ?? '').trim();
    if (!name || !f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) continue;
    const subj = String(f.properties?.SUBJECTO ?? '').trim();
    out.push({ name, subjectOf: subj && subj !== name ? subj : undefined, geom: f.geometry as RegionGeom, box: bbox(f.geometry) });
  }
  return out;
}

/** The polity a point falls in (the smallest one, when the dataset overlaps). */
function polityAt(ps: Polity[], p: [number, number]): Polity | null {
  let best: Polity | null = null;
  let bestArea = Infinity;
  for (const q of ps) {
    const b = q.box;
    if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue;
    if (!pointInGeom(p, q.geom)) continue;
    const a = (b[2] - b[0]) * (b[3] - b[1]);
    if (a < bestArea) [best, bestArea] = [q, a];
  }
  return best;
}

/** A short, stable code for a name: its letters, three of them, made unique. */
function codeFor(name: string, taken: Set<string>): string {
  const base = name.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase() || 'XXX';
  let code = base.slice(0, 3).padEnd(3, 'X');
  for (let i = 0; taken.has(code); i++) code = base.slice(0, 2) + String.fromCharCode(65 + (i % 26)) + (i >= 26 ? i : '');
  taken.add(code);
  return code;
}

/**
 * Re-deals the regions of `blank` (an unclaimed Earth bundle) to the states of the era: each
 * region goes to the state its label point lies in; colonies are vassals of their metropole.
 */
export function historicalEarth(
  blank: WorldBundle,
  fc: FeatureCollection,
  era: Era,
  /** Today's countries by name (lower case) → ISO code, and every ISO code that has a flag. */
  modern: { byName: Map<string, string>; iso: Set<string> } = { byName: new Map(), iso: new Set() },
): WorldBundle {
  const ps = polities(fc);
  const regions: Record<number, Region> = {};
  const cidOf = new Map<string, string>();
  // A state that still exists under the same name keeps its code (and so its flag); every other
  // code steers clear of today's, or Belgian Congo would fly the flag of Belgium.
  const taken = new Set<string>(modern.iso);
  const countries: Record<string, Country> = {};
  const ensure = (name: string) => {
    let cid = cidOf.get(name);
    if (!cid) {
      const same = modern.byName.get(name.toLowerCase());
      cid = same && !countries[same] ? same : codeFor(name, taken);
      cidOf.set(name, cid);
      countries[cid] = { cid, name, color: PALETTE[0], stats: {}, fields: {} };
    }
    return cid;
  };
  for (const r of Object.values(blank.doc.regions)) {
    const p = polityAt(ps, [r.cx, r.cy]);
    regions[r.id] = { ...r, cid: p ? ensure(p.name) : '' };
  }
  // Overlords: only those that hold land themselves.
  for (const p of ps) {
    const cid = cidOf.get(p.name);
    const over = p.subjectOf && cidOf.get(p.subjectOf);
    if (cid && over && over !== cid) countries[cid].overlord = over;
  }

  // Colours: neighbours differ (greedy, most-connected first), as on a school atlas.
  const engine = new GeoEngine();
  engine.build(blank.geoms);
  const adj: Record<string, Set<string>> = {};
  for (const r of Object.values(regions)) {
    if (!r.cid) continue;
    const a = (adj[r.cid] ??= new Set());
    for (const nb of engine.neighbors(r.id)) {
      const o = regions[nb]?.cid;
      if (o && o !== r.cid) a.add(o);
    }
  }
  const usage: Record<string, number> = {};
  const colour: Record<string, string> = {};
  for (const cid of Object.keys(countries).sort((a, b) => (adj[b]?.size ?? 0) - (adj[a]?.size ?? 0))) {
    const near = new Set([...(adj[cid] ?? [])].map((n) => colour[n]));
    const free = PALETTE.filter((c) => !near.has(c));
    const pool = free.length ? free : PALETTE;
    const c = pool.reduce((best, x) => ((usage[x] ?? 0) < (usage[best] ?? 0) ? x : best), pool[0]);
    colour[cid] = c;
    usage[c] = (usage[c] ?? 0) + 1;
    countries[cid].color = c;
  }

  // Capitals: the largest of today's cities inside each state (the dataset has none).
  const cities = Object.fromEntries(Object.values(blank.doc.cities).map((c) => [c.id, { ...c, capital: false }]));
  const best: Record<string, { id: number; pop: number }> = {};
  const boxes = Object.values(regions).map((r) => [r.id, bbox(blank.geoms[r.id])] as const);
  for (const c of Object.values(cities)) {
    const hit = boxes.find(([id, b]) => c.lng >= b[0] && c.lng <= b[2] && c.lat >= b[1] && c.lat <= b[3] && pointInGeom([c.lng, c.lat], blank.geoms[id]));
    const cid = hit && regions[hit[0]].cid;
    if (!cid) continue;
    if (!best[cid] || (c.pop ?? 0) > best[cid].pop) best[cid] = { id: c.id, pop: c.pop ?? 0 };
  }
  for (const [cid, b] of Object.entries(best)) {
    countries[cid].capital = b.id;
    cities[b.id].capital = true;
  }

  const now = Date.now();
  return {
    ...blank,
    doc: {
      ...blank.doc,
      meta: { ...blank.doc.meta, id: uid(), title: `Earth in ${era.year}`, created: now, modified: now, source: 'earth' },
      countries,
      regions,
      cities,
      alliances: [],
    },
    flags: {},
  };
}

/** Today's country names and the ISO codes the bundled flags use. */
export async function modernNames(): Promise<{ byName: Map<string, string>; iso: Set<string> }> {
  const [earth, iso] = await Promise.all([loadEarthData(), fetch(new URL('data/iso3to2.json', document.baseURI)).then((r) => r.json() as Promise<Record<string, string>>)]);
  return { byName: new Map(earth.countries.map((c) => [c.name.toLowerCase(), c.cid])), iso: new Set(Object.keys(iso)) };
}

/** Downloads (or reads from the cache) the map of the era. */
export function loadEra(era: Era): Promise<FeatureCollection> {
  return fetchCached(url(era), false);
}
