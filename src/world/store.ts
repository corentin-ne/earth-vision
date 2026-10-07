import { create } from 'zustand';
import type { City, Country, LngLat, Patch, Region, RegionGeom, WorldBundle, WorldDoc } from '../types';
import { GeoEngine, bbox, geomArea, labelPoint, pointInGeom } from '../geo/engine';
import { insertCutVertices, splitGeom } from '../geo/split';
import { healGeoms } from '../geo/heal';
import { rescale } from './stats';
import { uid } from '../util';

export type Tool = 'select' | 'paint' | 'split' | 'city';
export type MapStyleId = 'political' | 'atlas' | 'plain' | 'night';

export interface Layers {
  relief: boolean;
  hillshade: boolean;
  terrain: boolean;
  regionBorders: boolean;
  regionLabels: boolean;
  countryLabels: boolean;
  flags: boolean;
  cities: boolean;
  water: boolean;
  rivers: boolean;
  urban: boolean;
  graticule: boolean;
}

export interface Selection {
  cid: string | null;
  regions: number[];
  city: number | null;
}

interface HistoryEntry {
  label: string;
  fwd: Patch;
  inv: Patch;
  group?: string;
}

export interface ChangeSet {
  regions: Set<number>;
  countries: Set<string>;
  cities: boolean;
  geoms: boolean;
  all: boolean;
}

type Listener = (c: ChangeSet) => void;
const listeners = new Set<Listener>();
export function onWorldChange(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(c: ChangeSet) {
  listeners.forEach((l) => l(c));
}

/** Shared topology of the current world (kept outside React state). */
export const engine = new GeoEngine();
let bboxes = new Map<number, [number, number, number, number]>();

export interface State {
  doc: WorldDoc | null;
  geoms: Record<number, RegionGeom>;
  geomVersion: number;
  flags: Record<string, Blob>;
  flagUrls: Record<string, string>;
  passthrough?: Record<string, Uint8Array>;
  past: HistoryEntry[];
  future: HistoryEntry[];

  tool: Tool;
  brushCid: string;
  brushSize: number;
  selection: Selection;
  hover: { region: number | null; city: number | null };
  mapStyle: MapStyleId;
  globe: boolean;
  layers: Layers;
  toast: { id: number; text: string; kind?: 'error' | 'ok' } | null;
}

const DEFAULT_LAYERS: Layers = {
  relief: true,
  hillshade: true,
  terrain: false,
  regionBorders: true,
  regionLabels: true,
  countryLabels: true,
  flags: true,
  cities: true,
  water: true,
  rivers: true,
  urban: true,
  graticule: true,
};

const PREFS = 'cmaps:prefs';
function loadPrefs(): Partial<State> {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}');
    return { mapStyle: p.mapStyle, globe: p.globe, layers: p.layers ? { ...DEFAULT_LAYERS, ...p.layers } : undefined, brushSize: p.brushSize };
  } catch {
    return {};
  }
}
const prefs = loadPrefs();

export const useWorld = create<State>(() => ({
  doc: null,
  geoms: {},
  geomVersion: 0,
  flags: {},
  flagUrls: {},
  past: [],
  future: [],
  tool: 'select',
  brushCid: '',
  brushSize: prefs.brushSize ?? 0,
  selection: { cid: null, regions: [], city: null },
  hover: { region: null, city: null },
  mapStyle: prefs.mapStyle ?? 'political',
  globe: prefs.globe ?? true,
  layers: prefs.layers ?? DEFAULT_LAYERS,
  toast: null,
}));

useWorld.subscribe((s, prev) => {
  if (s.mapStyle !== prev.mapStyle || s.globe !== prev.globe || s.layers !== prev.layers || s.brushSize !== prev.brushSize) {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ mapStyle: s.mapStyle, globe: s.globe, layers: s.layers, brushSize: s.brushSize }));
    } catch {
      /* ignore */
    }
  }
});

const get = useWorld.getState;
const set = useWorld.setState;

// ── Patches ──────────────────────────────────────────────────────────────────

function rebuildGeometry(geoms: Record<number, RegionGeom>) {
  engine.build(geoms);
  bboxes = new Map(Object.entries(geoms).map(([id, g]) => [Number(id), bbox(g)]));
}

/** Applies a patch to the current world and returns the patch that undoes it. */
function apply(patch: Patch): { inv: Patch; changes: ChangeSet } {
  const s = get();
  const doc = s.doc!;
  const inv: Patch = {};
  const changes: ChangeSet = { regions: new Set(), countries: new Set(), cities: false, geoms: false, all: false };
  let regions = doc.regions;
  let countries = doc.countries;
  let cities = doc.cities;
  let geoms = s.geoms;

  if (patch.regions) {
    regions = { ...regions };
    inv.regions = {};
    for (const [k, v] of Object.entries(patch.regions)) {
      const id = Number(k);
      inv.regions[id] = regions[id] ?? null;
      if (regions[id]) changes.countries.add(regions[id].cid);
      if (v) {
        regions[id] = v;
        changes.countries.add(v.cid);
      } else delete regions[id];
      changes.regions.add(id);
    }
  }
  if (patch.countries) {
    countries = { ...countries };
    inv.countries = {};
    for (const [cid, v] of Object.entries(patch.countries)) {
      inv.countries[cid] = countries[cid] ?? null;
      if (v) countries[cid] = v;
      else delete countries[cid];
      changes.countries.add(cid);
    }
  }
  if (patch.cities) {
    cities = { ...cities };
    inv.cities = {};
    for (const [k, v] of Object.entries(patch.cities)) {
      const id = Number(k);
      inv.cities[id] = cities[id] ?? null;
      if (v) cities[id] = v;
      else delete cities[id];
    }
    changes.cities = true;
  }
  if (patch.geoms) {
    geoms = { ...geoms };
    inv.geoms = {};
    for (const [k, v] of Object.entries(patch.geoms)) {
      const id = Number(k);
      inv.geoms[id] = geoms[id] ?? null;
      if (v) geoms[id] = v;
      else delete geoms[id];
    }
    rebuildGeometry(geoms);
    changes.geoms = true;
  }
  changes.countries.delete('');
  const nextDoc: WorldDoc = { ...doc, regions, countries, cities, meta: { ...doc.meta, modified: Date.now() } };
  set({ doc: nextDoc, geoms, geomVersion: patch.geoms ? s.geomVersion + 1 : s.geomVersion });
  return { inv, changes };
}

/** Earlier values win: `a` happened first. */
function mergeInverse(a: Patch, b: Patch): Patch {
  const out: Patch = {};
  for (const key of ['regions', 'countries', 'cities', 'geoms'] as const) {
    if (a[key] || b[key]) out[key] = { ...(b[key] as object), ...(a[key] as object) } as never;
  }
  return out;
}

/** Later values win: `b` happened last. */
function mergeForward(a: Patch, b: Patch): Patch {
  const out: Patch = {};
  for (const key of ['regions', 'countries', 'cities', 'geoms'] as const) {
    if (a[key] || b[key]) out[key] = { ...(a[key] as object), ...(b[key] as object) } as never;
  }
  return out;
}

/**
 * Countries whose territory a region patch changes get their label anchor
 * recomputed in the same patch, so undo restores it too.
 */
function withDerived(patch: Patch): Patch {
  if (!patch.regions && !patch.geoms) return patch;
  const doc = get().doc!;
  const touched = new Set<string>();
  const nextRegions = { ...doc.regions };
  for (const [k, v] of Object.entries(patch.regions ?? {})) {
    const id = Number(k);
    if (doc.regions[id]) touched.add(doc.regions[id].cid);
    if (v) {
      touched.add(v.cid);
      nextRegions[id] = v;
    } else delete nextRegions[id];
  }
  for (const k of Object.keys(patch.geoms ?? {})) {
    const r = nextRegions[Number(k)];
    if (r) touched.add(r.cid);
  }
  touched.delete('');
  if (!touched.size) return patch;
  const ids: Record<string, number[]> = {};
  for (const r of Object.values(nextRegions)) if (touched.has(r.cid)) (ids[r.cid] ??= []).push(r.id);
  const countries = { ...patch.countries };
  for (const cid of touched) {
    const base = countries[cid] === undefined ? doc.countries[cid] : countries[cid];
    if (!base) continue;
    const lp = ids[cid]?.length ? labelPoint(engine.merge(ids[cid])) : null;
    countries[cid] = { ...base, label: lp ?? base.label };
  }
  return { ...patch, countries };
}

export function commit(label: string, patch: Patch, opts: { group?: string } = {}) {
  if (!get().doc) return;
  // Geometry first so label anchors are computed on the new shapes.
  let full: Patch;
  let inv: Patch;
  let changes: ChangeSet;
  if (patch.geoms) {
    const g = apply({ geoms: patch.geoms });
    const rest = withDerived({ regions: patch.regions, countries: patch.countries, cities: patch.cities, geoms: patch.geoms });
    const r = apply({ regions: rest.regions, countries: rest.countries, cities: rest.cities });
    full = { ...rest };
    inv = mergeInverse(g.inv, r.inv);
    changes = { ...r.changes, geoms: true, regions: new Set([...g.changes.regions, ...r.changes.regions]) };
  } else {
    full = withDerived(patch);
    const r = apply(full);
    inv = r.inv;
    changes = r.changes;
  }
  const past = get().past;
  const top = past[past.length - 1];
  if (opts.group && top?.group === opts.group) {
    const merged: HistoryEntry = { ...top, label, fwd: mergeForward(top.fwd, full), inv: mergeInverse(top.inv, inv) };
    set({ past: [...past.slice(0, -1), merged], future: [] });
  } else {
    set({ past: [...past.slice(-199), { label, fwd: full, inv, group: opts.group }], future: [] });
  }
  emit(changes);
}

/** Closes an open history group so the next stroke starts a new undo step. */
export function endGroup() {
  const past = get().past;
  const top = past[past.length - 1];
  if (top?.group) set({ past: [...past.slice(0, -1), { ...top, group: undefined }] });
}

function replay(entry: HistoryEntry, patch: Patch) {
  const geomFirst = patch.geoms ? apply({ geoms: patch.geoms }) : null;
  const r = apply({ regions: patch.regions, countries: patch.countries, cities: patch.cities });
  const changes = r.changes;
  if (geomFirst) {
    changes.geoms = true;
    geomFirst.changes.regions.forEach((id) => changes.regions.add(id));
  }
  emit(changes);
  return entry;
}

export function undo() {
  const { past, future } = get();
  const e = past[past.length - 1];
  if (!e) return;
  set({ past: past.slice(0, -1), future: [...future, e] });
  replay(e, e.inv);
  toast(`Undid: ${e.label}`);
}

export function redo() {
  const { past, future } = get();
  const e = future[future.length - 1];
  if (!e) return;
  set({ future: future.slice(0, -1), past: [...past, e] });
  replay(e, e.fwd);
  toast(`Redid: ${e.label}`);
}

// ── Loading ──────────────────────────────────────────────────────────────────

export function loadWorld(b: WorldBundle) {
  for (const url of Object.values(get().flagUrls)) URL.revokeObjectURL(url);
  rebuildGeometry(b.geoms);
  // Worlds from templates come without label anchors: place them once.
  const missing = Object.values(b.doc.countries).filter((c) => !c.label);
  if (missing.length) {
    const ids: Record<string, number[]> = {};
    for (const r of Object.values(b.doc.regions)) (ids[r.cid] ??= []).push(r.id);
    const countries = { ...b.doc.countries };
    for (const c of missing) {
      const lp = ids[c.cid] ? labelPoint(engine.merge(ids[c.cid])) : null;
      if (lp) countries[c.cid] = { ...c, label: lp };
    }
    b = { ...b, doc: { ...b.doc, countries } };
  }
  const flagUrls = Object.fromEntries(Object.entries(b.flags).map(([k, blob]) => [k, URL.createObjectURL(blob)]));
  set({
    doc: b.doc,
    geoms: b.geoms,
    geomVersion: get().geomVersion + 1,
    flags: b.flags,
    flagUrls,
    passthrough: b.passthrough,
    past: [],
    future: [],
    selection: { cid: null, regions: [], city: null },
    hover: { region: null, city: null },
    tool: 'select',
    brushCid: Object.keys(b.doc.countries)[0] ?? '',
  });
  emit({ regions: new Set(), countries: new Set(), cities: true, geoms: true, all: true });
}

export function closeWorld() {
  for (const url of Object.values(get().flagUrls)) URL.revokeObjectURL(url);
  set({ doc: null, geoms: {}, flags: {}, flagUrls: {}, past: [], future: [], passthrough: undefined });
}

export function currentBundle(): WorldBundle {
  const s = get();
  return { doc: s.doc!, geoms: s.geoms, flags: s.flags, passthrough: s.passthrough };
}

// ── UI helpers ───────────────────────────────────────────────────────────────

let toastId = 0;
export function toast(text: string, kind?: 'error' | 'ok') {
  const id = ++toastId;
  set({ toast: { id, text, kind } });
  setTimeout(() => {
    if (get().toast?.id === id) set({ toast: null });
  }, kind === 'error' ? 5000 : 2200);
}

export function select(sel: Partial<Selection>) {
  set({ selection: { cid: null, regions: [], city: null, ...sel } });
}

export function setTool(tool: Tool) {
  const { selection, doc } = get();
  // Painting starts with the selected country as the brush.
  if (tool === 'paint' && selection.cid && doc?.countries[selection.cid]) set({ tool, brushCid: selection.cid });
  else set({ tool });
}

// ── Queries ──────────────────────────────────────────────────────────────────

export interface CountryAgg {
  area: number;
  regions: number;
  vals: Record<string, number>;
}

let aggCache: { regions: unknown; out: Record<string, CountryAgg> } = { regions: null, out: {} };
/** Area, region count and summed scaling stats per country (memoized). */
export function countryAggregates(doc: WorldDoc): Record<string, CountryAgg> {
  if (aggCache.regions === doc.regions) return aggCache.out;
  const out: Record<string, CountryAgg> = {};
  for (const r of Object.values(doc.regions)) {
    const a = (out[r.cid] ??= { area: 0, regions: 0, vals: {} });
    a.area += r.area;
    a.regions++;
    if (r.vals) for (const [k, v] of Object.entries(r.vals)) a.vals[k] = (a.vals[k] ?? 0) + v;
  }
  aggCache = { regions: doc.regions, out };
  return out;
}

export function regionsOf(cid: string): Region[] {
  const doc = get().doc;
  if (!doc) return [];
  return Object.values(doc.regions).filter((r) => r.cid === cid);
}

export function regionAt(pt: LngLat): Region | null {
  const { doc, geoms } = get();
  if (!doc) return null;
  for (const [id, b] of bboxes) {
    if (pt[0] < b[0] || pt[0] > b[2] || pt[1] < b[1] || pt[1] > b[3]) continue;
    if (geoms[id] && pointInGeom(pt, geoms[id])) return doc.regions[id] ?? null;
  }
  return null;
}

export function countryBounds(cid: string): [number, number, number, number] | null {
  return boundsOf(regionsOf(cid).map((r) => r.id));
}

export function boundsOf(ids: number[]): [number, number, number, number] | null {
  let out: [number, number, number, number] | null = null;
  for (const id of ids) {
    const b = bboxes.get(id);
    if (!b) continue;
    out = out ? [Math.min(out[0], b[0]), Math.min(out[1], b[1]), Math.max(out[2], b[2]), Math.max(out[3], b[3])] : [...b];
  }
  return out;
}

export function flagUrlFor(c: Country | undefined, iso2: Record<string, string>): string | null {
  if (!c) return null;
  const s = get();
  if (c.flag && s.flagUrls[c.flag]) return s.flagUrls[c.flag];
  const code = iso2[c.cid];
  return code ? new URL(`flags/${code}.png`, document.baseURI).href : null;
}

// ── Editing operations ───────────────────────────────────────────────────────

export function transferRegions(ids: number[], cid: string, opts: { group?: string; label?: string } = {}) {
  const doc = get().doc;
  if (!doc) return 0;
  const regions: Record<number, Region> = {};
  for (const id of ids) {
    const r = doc.regions[id];
    if (r && r.cid !== cid) regions[id] = { ...r, cid };
  }
  const n = Object.keys(regions).length;
  if (!n) return 0;
  const name = cid ? doc.countries[cid]?.name ?? cid : 'unclaimed land';
  commit(opts.label ?? `Give ${n} region${n > 1 ? 's' : ''} to ${name}`, { regions }, { group: opts.group });
  return n;
}

function newCid(name: string, taken: Record<string, unknown>): string {
  const letters = name
    .normalize('NFD')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase();
  const tries = [letters.slice(0, 3), letters[0] + letters.slice(2, 4), letters.slice(0, 2) + letters.slice(-1)];
  for (const t of tries) if (t.length === 3 && !taken[t]) return t;
  for (let i = 0; i < 1000; i++) {
    const t = (letters[0] ?? 'X') + String.fromCharCode(65 + Math.floor(Math.random() * 26)) + String.fromCharCode(65 + Math.floor(Math.random() * 26));
    if (!taken[t]) return t;
  }
  return uid().slice(0, 6).toUpperCase();
}

/** A palette colour that none of the neighbouring countries use. */
export function freeColor(regionIds: number[]): string {
  const doc = get().doc!;
  const set_ = new Set(regionIds);
  const near = engine.neighborsOfSet((id) => set_.has(id));
  const used = new Set<string>();
  for (const id of near) {
    const c = doc.countries[doc.regions[id]?.cid];
    if (c) used.add(c.color.toUpperCase());
  }
  const palette = doc.settings.palette.length ? doc.settings.palette : ['#D6C7FF'];
  const free = palette.filter((c) => !used.has(c.toUpperCase()));
  const pool = free.length ? free : palette;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function createCountry(name: string, regionIds: number[] = [], extra: Partial<Country> = {}): string {
  const doc = get().doc!;
  const cid = extra.cid && !doc.countries[extra.cid] ? extra.cid : newCid(name, doc.countries);
  const country: Country = {
    cid,
    name,
    color: extra.color ?? freeColor(regionIds),
    stats: {},
    fields: {},
    ...extra,
  };
  const regions: Record<number, Region> = {};
  for (const id of regionIds) if (doc.regions[id]) regions[id] = { ...doc.regions[id], cid };
  commit(`Create ${name}`, { countries: { [cid]: country }, regions });
  return cid;
}

export function updateCountry(cid: string, changes: Partial<Country>, label = 'Edit country') {
  const c = get().doc?.countries[cid];
  if (!c) return;
  commit(label, { countries: { [cid]: { ...c, ...changes } } }, { group: `edit:${cid}:${Object.keys(changes).join(',')}` });
}

export function deleteCountry(cid: string) {
  const doc = get().doc!;
  const c = doc.countries[cid];
  if (!c) return;
  const regions: Record<number, Region> = {};
  for (const r of Object.values(doc.regions)) if (r.cid === cid) regions[r.id] = { ...r, cid: '' };
  commit(`Dissolve ${c.name}`, { countries: { [cid]: null }, regions });
  const sel = get().selection;
  if (sel.cid === cid) select({});
}

export function annexCountry(src: string, dst: string) {
  const doc = get().doc!;
  const a = doc.countries[src];
  const b = doc.countries[dst];
  if (!a || !b || src === dst) return;
  const regions: Record<number, Region> = {};
  for (const r of Object.values(doc.regions)) if (r.cid === src) regions[r.id] = { ...r, cid: dst };
  commit(`${b.name} annexes ${a.name}`, { countries: { [src]: null }, regions });
  select({ cid: dst });
}

export function setStat(cid: string, key: string, value: number) {
  const doc = get().doc!;
  const def = doc.settings.stats.find((s) => s.key === key);
  const c = doc.countries[cid];
  if (!c) return;
  if (def?.scale) {
    const rs = regionsOf(cid);
    if (!rs.length) return;
    const next = rescale(rs, key, value);
    commit(`Set ${key} of ${c.name}`, { regions: Object.fromEntries(next.map((r) => [r.id, r])) }, { group: `stat:${cid}:${key}` });
  } else {
    commit(`Set ${key} of ${c.name}`, { countries: { [cid]: { ...c, stats: { ...c.stats, [key]: value } } } }, { group: `stat:${cid}:${key}` });
  }
}

export function updateRegion(id: number, changes: Partial<Region>, label = 'Edit region') {
  const r = get().doc?.regions[id];
  if (!r) return;
  commit(label, { regions: { [id]: { ...r, ...changes } } }, { group: `region:${id}:${Object.keys(changes).join(',')}` });
}

export function nextRegionId(): number {
  const doc = get().doc!;
  let max = -1;
  for (const k of Object.keys(doc.regions)) max = Math.max(max, Number(k));
  for (const k of Object.keys(get().geoms)) max = Math.max(max, Number(k));
  return max + 1;
}

/** Cuts every region the line crosses. Returns how many regions were split. */
export function splitAlong(line: LngLat[], only?: number[]): number {
  const { doc, geoms } = get();
  if (!doc || line.length < 2) return 0;
  const [lx0, ly0, lx1, ly1] = bbox({ type: 'LineString', coordinates: line });
  const candidates = only ?? [...bboxes].filter(([, b]) => !(b[2] < lx0 || b[0] > lx1 || b[3] < ly0 || b[1] > ly1)).map(([id]) => id);
  const patch: Required<Pick<Patch, 'regions' | 'geoms'>> = { regions: {}, geoms: {} };
  let nextId = nextRegionId();
  let count = 0;
  const workGeoms: Record<number, RegionGeom> = { ...geoms };
  for (const id of candidates) {
    const g = workGeoms[id];
    const r = doc.regions[id];
    if (!g || !r) continue;
    let pieces: [RegionGeom, RegionGeom] | null = null;
    try {
      pieces = splitGeom(g, line);
    } catch (e) {
      console.warn('split failed', id, e);
    }
    if (!pieces) continue;
    count++;
    // Keep the old id on the larger piece.
    const [big, small] = geomArea(pieces[0]) >= geomArea(pieces[1]) ? pieces : [pieces[1], pieces[0]];
    const sid = nextId++;
    const aBig = geomArea(big);
    const aSmall = geomArea(small);
    const total = aBig + aSmall || 1;
    const share = (k: number) => (r.vals ? Object.fromEntries(Object.entries(r.vals).map(([key, v]) => [key, v * k])) : undefined);
    const lpB = labelPoint(big) ?? [r.cx, r.cy];
    const lpS = labelPoint(small) ?? [r.cx, r.cy];
    patch.geoms[id] = big;
    patch.geoms[sid] = small;
    // Areas are shares of the stored area so totals never drift.
    patch.regions[id] = { ...r, area: (r.area * aBig) / total, cx: lpB[0], cy: lpB[1], vals: share(aBig / total) };
    patch.regions[sid] = { id: sid, name: `${r.name} (2)`, cid: r.cid, area: (r.area * aSmall) / total, cx: lpS[0], cy: lpS[1], vals: share(aSmall / total) };
    workGeoms[id] = big;
    workGeoms[sid] = small;
    // Make sure neighbours carry the new border vertices.
    const nbIds = engine.neighbors(id);
    const nb: Record<number, RegionGeom> = {};
    for (const n of nbIds) if (workGeoms[n]) nb[n] = workGeoms[n];
    const fixed = insertCutVertices([big, small], g, nb);
    for (const [k, v] of Object.entries(fixed)) {
      patch.geoms[Number(k)] = v;
      workGeoms[Number(k)] = v;
    }
  }
  if (count) commit(`Split ${count} region${count > 1 ? 's' : ''}`, patch);
  return count;
}

export function mergeRegions(ids: number[]): number | null {
  const doc = get().doc!;
  const rs = ids.map((id) => doc.regions[id]).filter(Boolean);
  if (rs.length < 2) return null;
  const merged = engine.merge(rs.map((r) => r.id));
  if (!merged) return null;
  const keep = rs.reduce((a, b) => (b.area > a.area ? b : a));
  const geom: RegionGeom = merged.coordinates.length === 1 ? { type: 'Polygon', coordinates: merged.coordinates[0] } : merged;
  const vals: Record<string, number> = {};
  for (const r of rs) for (const [k, v] of Object.entries(r.vals ?? {})) vals[k] = (vals[k] ?? 0) + v;
  const lp = labelPoint(geom) ?? [keep.cx, keep.cy];
  const patch: Patch = { regions: {}, geoms: {} };
  for (const r of rs) {
    if (r.id === keep.id) continue;
    patch.regions![r.id] = null;
    patch.geoms![r.id] = null;
  }
  patch.geoms![keep.id] = geom;
  patch.regions![keep.id] = { ...keep, area: rs.reduce((t, r) => t + r.area, 0), cx: lp[0], cy: lp[1], vals: Object.keys(vals).length ? vals : undefined };
  commit(`Merge ${rs.length} regions`, patch);
  select({ cid: keep.cid || null, regions: [keep.id] });
  return keep.id;
}

/**
 * Snaps borders that almost line up so they become shared, removing the stray
 * lines that bad imports or old splits leave inside countries. Runs in a worker
 * so the map stays responsive. Resolves to how many regions were repaired.
 */
export async function healBorders(tol = 0.01): Promise<number> {
  const { doc, geoms } = get();
  if (!doc) return 0;
  let fixed: Record<number, RegionGeom>;
  if (typeof Worker === 'undefined') fixed = healGeoms(geoms, tol);
  else {
    const w = new Worker(new URL('../geo/heal.worker.ts', import.meta.url), { type: 'module' });
    try {
      fixed = await new Promise((resolve, reject) => {
        w.onmessage = (e) => (e.data.ok ? resolve(e.data.fixed) : reject(new Error(e.data.error)));
        w.onerror = (e) => reject(new Error(e.message || 'Worker failed'));
        w.postMessage({ geoms, tol });
      });
    } finally {
      w.terminate();
    }
  }
  // The world may have been closed or swapped while the worker ran.
  if (get().geoms !== geoms) return 0;
  const n = Object.keys(fixed).length;
  if (n) commit('Heal borders', { geoms: fixed });
  return n;
}

// ── Cities ───────────────────────────────────────────────────────────────────

export function addCity(lng: number, lat: number, name = 'New city'): number {
  const doc = get().doc!;
  const id = Math.max(-1, ...Object.keys(doc.cities).map(Number)) + 1;
  commit(`Add ${name}`, { cities: { [id]: { id, name, lng, lat, capital: false } } });
  return id;
}

export function updateCity(id: number, changes: Partial<City>, label = 'Edit city') {
  const c = get().doc?.cities[id];
  if (!c) return;
  commit(label, { cities: { [id]: { ...c, ...changes } } }, { group: `city:${id}:${Object.keys(changes).join(',')}` });
}

export function deleteCity(id: number) {
  const doc = get().doc!;
  const c = doc.cities[id];
  if (!c) return;
  const countries: Record<string, Country> = {};
  for (const k of Object.values(doc.countries)) if (k.capital === id) countries[k.cid] = { ...k, capital: undefined };
  commit(`Delete ${c.name}`, { cities: { [id]: null }, countries });
  select({});
}

/** Makes a city the capital of the country it lies in. */
export function makeCapital(cityId: number) {
  const doc = get().doc!;
  const city = doc.cities[cityId];
  if (!city) return;
  const owner = regionAt([city.lng, city.lat]);
  const c = owner && doc.countries[owner.cid];
  if (!c) {
    toast('This city is not inside a country', 'error');
    return;
  }
  const patch: Patch = { countries: { [c.cid]: { ...c, capital: cityId } }, cities: { [cityId]: { ...city, capital: true } } };
  const prev = c.capital != null ? doc.cities[c.capital] : null;
  if (prev && prev.id !== cityId) patch.cities![prev.id] = { ...prev, capital: false };
  commit(`${city.name} becomes capital of ${c.name}`, patch);
}

// ── Flags ────────────────────────────────────────────────────────────────────

export function setFlag(cid: string, blob: Blob | null) {
  const s = get();
  const c = s.doc?.countries[cid];
  if (!c) return;
  if (!blob) {
    commit(`Remove flag of ${c.name}`, { countries: { [cid]: { ...c, flag: undefined } } });
    return;
  }
  const key = `${cid}-${uid().slice(0, 8)}`;
  set({ flags: { ...s.flags, [key]: blob }, flagUrls: { ...s.flagUrls, [key]: URL.createObjectURL(blob) } });
  commit(`New flag for ${c.name}`, { countries: { [cid]: { ...c, flag: key } } });
}

export function setTitle(title: string) {
  const doc = get().doc;
  if (!doc) return;
  set({ doc: { ...doc, meta: { ...doc.meta, title, modified: Date.now() } } });
}
