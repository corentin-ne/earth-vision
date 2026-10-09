// Thematic maps: countries coloured by a figure (population, density, GDP per person…) in
// classes, by a text field (language, government…) as categories, by realm (vassals in their
// overlord's colour) or by state.
import type { Country, Region, WorldDoc } from '../types';
import { countryAggregates, type Thematic } from './store';
import { mix, stateColor } from './edits';
import { fmtCompact } from '../util';

export interface LegendItem {
  color: string;
  label: string;
}

export interface ThematicResult {
  title: string;
  /** Colour per country; countries left out are greyed. */
  colors: Record<string, string>;
  legend: LegendItem[];
  /** Colour per region, when it differs from its country's (states). */
  regionColor?: (r: Region) => string | null;
}

/** Light to dark, five classes (colour-blind safe). */
const SEQ = ['#fde7c4', '#f9b77a', '#ec7a4e', '#c64538', '#86203a'];
const CATS = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#86bcb6', '#d37295', '#a0cbe8'];
export const NO_DATA = '#d9d6cf';

/** Every way the map can be coloured for this world, for the picker. */
export function thematicOptions(doc: WorldDoc): { value: Thematic; label: string }[] {
  const out: { value: Thematic; label: string }[] = [];
  const pop = doc.settings.stats.find((s) => s.scale);
  for (const s of doc.settings.stats) {
    out.push({ value: { kind: 'stat', key: s.key, per: 'total' }, label: s.key });
    if (s.scale) out.push({ value: { kind: 'stat', key: s.key, per: 'area' }, label: `${s.key} per km²` });
    if (pop && s.key !== pop.key) out.push({ value: { kind: 'stat', key: s.key, per: 'capita' }, label: `${s.key} per person` });
  }
  out.push({ value: { kind: 'stat', key: '__area', per: 'total' }, label: 'Area' });
  for (const f of doc.settings.fields) out.push({ value: { kind: 'field', key: f }, label: f });
  out.push({ value: { kind: 'realm' }, label: 'Realms (vassals with their overlord)' });
  out.push({ value: { kind: 'states' }, label: 'States & provinces' });
  return out;
}

export const thematicKey = (t: Thematic | null) => (t ? JSON.stringify(t) : '');

let cache: { key: string; countries: unknown; regions: unknown; out: ThematicResult } | null = null;

export function computeThematic(doc: WorldDoc, t: Thematic): ThematicResult {
  const key = thematicKey(t);
  if (cache && cache.key === key && cache.countries === doc.countries && cache.regions === doc.regions) return cache.out;
  const out = compute(doc, t);
  cache = { key, countries: doc.countries, regions: doc.regions, out };
  return out;
}

function compute(doc: WorldDoc, t: Thematic): ThematicResult {
  const agg = countryAggregates(doc);
  const owned = Object.values(doc.countries).filter((c) => agg[c.cid]?.regions);
  if (t.kind === 'realm') {
    const colors: Record<string, string> = {};
    const legend: LegendItem[] = [];
    const top = (c: Country) => {
      let cur = c;
      for (let n = 0; n < 100 && cur.overlord && doc.countries[cur.overlord]; n++) cur = doc.countries[cur.overlord];
      return cur;
    };
    for (const c of owned) {
      const lord = top(c);
      colors[c.cid] = lord === c ? c.color : mix(lord.color, '#ffffff', 0.28);
    }
    for (const c of owned)
      if (!c.overlord && owned.some((v) => v.overlord === c.cid)) legend.push({ color: c.color, label: `${c.name} & vassals` });
    if (!legend.length) legend.push({ color: NO_DATA, label: 'No vassals yet: set an overlord on a country page' });
    return { title: 'Realms', colors, legend: legend.slice(0, 12) };
  }
  if (t.kind === 'states') {
    const colors: Record<string, string> = {};
    for (const c of owned) colors[c.cid] = c.color;
    const n = owned.reduce((s, c) => s + Object.keys(c.states ?? {}).length, 0);
    return {
      title: 'States & provinces',
      colors,
      legend: [{ color: NO_DATA, label: n ? `${n} states, shaded within their country` : 'No states yet: create them on a country page' }],
      regionColor: (r) => {
        const c = doc.countries[r.cid];
        return c && r.state && c.states?.[r.state] ? stateColor(c, r.state) : null;
      },
    };
  }
  if (t.kind === 'field') {
    const values = new Map<string, number>();
    for (const c of owned) {
      const v = c.fields[t.key]?.trim();
      if (v) values.set(v, (values.get(v) ?? 0) + (agg[c.cid]?.area ?? 0));
    }
    // The most widespread values get their own colour; the rest share one.
    const ranked = [...values.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
    const own = ranked.slice(0, CATS.length - (ranked.length > CATS.length ? 1 : 0));
    const colorOf = new Map(own.map((v, i) => [v, CATS[i]]));
    const other = '#bab0ac';
    const colors: Record<string, string> = {};
    for (const c of owned) {
      const v = c.fields[t.key]?.trim();
      colors[c.cid] = v ? colorOf.get(v) ?? other : NO_DATA;
    }
    const legend = own.map((v) => ({ color: colorOf.get(v)!, label: v }));
    if (ranked.length > own.length) legend.push({ color: other, label: `${ranked.length - own.length} others` });
    legend.push({ color: NO_DATA, label: 'Not set' });
    return { title: t.key, colors, legend };
  }
  // Figures, in five classes of equal count (quantiles), so a few giants don't wash out the rest.
  const pop = doc.settings.stats.find((s) => s.scale)?.key;
  const isScale = doc.settings.stats.find((s) => s.key === t.key)?.scale;
  const raw = (c: Country) => (t.key === '__area' ? agg[c.cid]?.area ?? 0 : isScale ? agg[c.cid]?.vals[t.key] ?? 0 : c.stats[t.key] ?? 0);
  const value = (c: Country): number | null => {
    const v = raw(c);
    if (t.per === 'area') return agg[c.cid]?.area ? v / agg[c.cid].area : null;
    if (t.per === 'capita') {
      const p = pop ? agg[c.cid]?.vals[pop] ?? 0 : 0;
      return p > 0 ? v / p : null;
    }
    return v;
  };
  const vals = owned.map((c) => [c.cid, value(c)] as const).filter((x): x is readonly [string, number] => x[1] != null && x[1] > 0);
  const sorted = vals.map((x) => x[1]).sort((a, b) => a - b);
  const breaks: number[] = [];
  for (let i = 1; i < SEQ.length; i++) breaks.push(sorted[Math.floor((sorted.length * i) / SEQ.length)] ?? Infinity);
  const cls = (v: number) => breaks.filter((b) => v >= b).length;
  const colors: Record<string, string> = {};
  for (const c of owned) colors[c.cid] = NO_DATA;
  for (const [cid, v] of vals) colors[cid] = SEQ[cls(v)];
  const unit = t.per === 'area' ? ' /km²' : t.per === 'capita' ? ' per person' : t.key === '__area' ? ' km²' : '';
  const fmt = (v: number) => (v < 10 ? v.toFixed(v < 1 ? 2 : 1) : fmtCompact(v));
  const legend: LegendItem[] = [];
  if (sorted.length) {
    const edges = [sorted[0], ...breaks, sorted[sorted.length - 1]];
    for (let i = 0; i < SEQ.length; i++) {
      if (!Number.isFinite(edges[i + 1]) || (i > 0 && edges[i] === edges[i + 1] && i < SEQ.length - 1)) continue;
      legend.push({ color: SEQ[i], label: `${fmt(edges[i])} – ${fmt(edges[i + 1])}${unit}` });
    }
  }
  legend.push({ color: NO_DATA, label: 'No data' });
  const title = t.key === '__area' ? 'Area' : t.per === 'area' ? `${t.key} per km²` : t.per === 'capita' ? `${t.key} per person` : t.key;
  return { title, colors, legend };
}
