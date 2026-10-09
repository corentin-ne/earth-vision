import { create } from 'zustand';
import type { Alliance, City, Country, LngLat, Patch, Region, RegionGeom, WorldBundle, WorldDoc } from '../types';
import { GeoEngine, bbox, geomArea, labelPoint, pointInGeom } from '../geo/engine';
import { insertCutVertices, splitGeom } from '../geo/split';
import { healGeoms } from '../geo/heal';
import { cleanGeom, geomIssues, repairGeom, unionGeoms } from '../geo/repair';
import type { NaturalOpts } from '../geo/barriers';
import { rescale } from './stats';
import { uid } from '../util';

export type Tool = 'select' | 'paint' | 'split' | 'city';
export type MapStyleId = 'political' | 'atlas' | 'plain' | 'night';

export interface Layers {
  relief: boolean;
  hillshade: boolean;
  terrain: boolean;
  /** Animated surf along the coasts. */
  waves: boolean;
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
  /** Where the selection bubble points (the clicked spot); defaults to the thing's label point. */
  anchor?: LngLat;
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
  alliances: boolean;
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
  /** Keyboard shortcuts overlay. */
  help: boolean;
  layersOpen: boolean;
  /** Touch-friendly stand-ins for Alt+click (pick) and Ctrl+click (whole country) while painting. */
  brushMode: 'paint' | 'pick' | 'whole';
  /** Touch-friendly stand-in for Shift+click: clicks add regions to the selection. */
  multiSelect: boolean;
  advancedOpen: boolean;
  /** The full details window of the current selection. */
  detailsOpen: boolean;
  /** Screen space each docked panel covers (px), so the map centres in what's left. */
  docks: Record<string, { right: number; bottom: number }>;
  /** Phones: the world overview panel is open. */
  worldOpen: boolean;
  /** Country whose flag is being designed in the flag maker. */
  flagMakerFor: string | null;
  /** Country whose flag is shown full size. */
  flagView: string | null;
  galleryOpen: boolean;
  /** Rivers and crests the brush stops at (and cuts regions along). */
  natural: NaturalOpts;
  /** Colour the map by alliance: null = off, 'all', or one alliance's id. */
  allianceView: string | null;
  /** Every panel and button hidden: just the map. */
  zen: boolean;
  /**
   * Snapping a country's border with a neighbour onto rivers and crests: which two countries,
   * and whether the user is drawing a loop around the part of the border to snap.
   */
  snap: { cid: string; other: string | null; drawing: boolean } | null;
}

const DEFAULT_LAYERS: Layers = {
  relief: true,
  hillshade: true,
  terrain: false,
  waves: true,
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
    return {
      mapStyle: p.mapStyle,
      globe: p.globe,
      layers: p.layers ? { ...DEFAULT_LAYERS, ...p.layers } : undefined,
      brushSize: p.brushSize,
      natural: p.natural?.rivers ? p.natural : undefined,
    };
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
  help: false,
  layersOpen: false,
  brushMode: 'paint',
  multiSelect: false,
  advancedOpen: false,
  detailsOpen: false,
  docks: {},
  worldOpen: false,
  flagMakerFor: null,
  flagView: null,
  galleryOpen: false,
  natural: prefs.natural ?? { rivers: 'off', crests: false },
  allianceView: null,
  zen: false,
  snap: null,
}));

useWorld.subscribe((s, prev) => {
  if (s.mapStyle !== prev.mapStyle || s.globe !== prev.globe || s.layers !== prev.layers || s.brushSize !== prev.brushSize || s.natural !== prev.natural) {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ mapStyle: s.mapStyle, globe: s.globe, layers: s.layers, brushSize: s.brushSize, natural: s.natural }));
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
  const changes: ChangeSet = { regions: new Set(), countries: new Set(), cities: false, geoms: false, alliances: false, all: false };
  let regions = doc.regions;
  let countries = doc.countries;
  let cities = doc.cities;
  let geoms = s.geoms;
  let alliances = doc.alliances;

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
  if (patch.alliances) {
    alliances = [...alliances];
    inv.alliances = {};
    for (const [id, v] of Object.entries(patch.alliances)) {
      const i = alliances.findIndex((a) => a.id === id);
      inv.alliances[id] = i >= 0 ? alliances[i] : null;
      if (v && i >= 0) alliances[i] = v;
      else if (v) alliances.push(v);
      else if (i >= 0) alliances.splice(i, 1);
    }
    changes.alliances = true;
  }
  changes.countries.delete('');
  const nextDoc: WorldDoc = { ...doc, regions, countries, cities, alliances, meta: { ...doc.meta, modified: Date.now() } };
  set({ doc: nextDoc, geoms, geomVersion: patch.geoms ? s.geomVersion + 1 : s.geomVersion });
  return { inv, changes };
}

/** Earlier values win: `a` happened first. */
function mergeInverse(a: Patch, b: Patch): Patch {
  const out: Patch = {};
  for (const key of ['regions', 'countries', 'cities', 'geoms', 'alliances'] as const) {
    if (a[key] || b[key]) out[key] = { ...(b[key] as object), ...(a[key] as object) } as never;
  }
  return out;
}

/** Later values win: `b` happened last. */
function mergeForward(a: Patch, b: Patch): Patch {
  const out: Patch = {};
  for (const key of ['regions', 'countries', 'cities', 'geoms', 'alliances'] as const) {
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
  return { ...patch, countries: relabel(touched, nextRegions, { ...patch.countries }) };
}

/** Puts the label anchors of the `touched` countries, placed on `regions`, into `countries`. */
function relabel(touched: Set<string>, regions: Record<number, Region>, countries: Record<string, Country | null>) {
  const doc = get().doc!;
  const ids: Record<string, number[]> = {};
  for (const r of Object.values(regions)) if (touched.has(r.cid)) (ids[r.cid] ??= []).push(r.id);
  for (const cid of touched) {
    const base = countries[cid] === undefined ? doc.countries[cid] : countries[cid];
    if (!base) continue;
    const lp = ids[cid]?.length ? labelPoint(engine.merge(ids[cid])) : null;
    countries[cid] = { ...base, label: lp ?? base.label };
  }
  return countries;
}

/** Countries whose labels wait for the end of the paint stroke (see commit's `deferLabels`). */
const pendingLabels = new Set<string>();

/**
 * Applies a change and records it for undo. Commits sharing a `group` (one paint stroke) are
 * one undo step. `deferLabels` leaves the country label anchors to `endGroup`: placing them
 * costs a merge and a polylabel per country, too much to redo at every step of a stroke.
 */
export function commit(label: string, patch: Patch, opts: { group?: string; deferLabels?: boolean } = {}) {
  const doc = get().doc;
  if (!doc) return;
  // Every new shape is checked: a broken one (open ring, spike, zero-area loop…) is rebuilt
  // before it reaches the map, the merge or the saved file.
  if (patch.geoms) {
    const geoms: Record<number, RegionGeom | null> = {};
    for (const [k, g] of Object.entries(patch.geoms)) {
      const clean = g && cleanGeom(g);
      if (g && clean !== g) console.warn(`Repaired region ${k}:`, geomIssues(g).join('; '));
      geoms[Number(k)] = clean;
    }
    patch = { ...patch, geoms };
  }
  // Geometry first so label anchors are computed on the new shapes.
  let full: Patch;
  let inv: Patch;
  let changes: ChangeSet;
  if (patch.geoms) {
    const g = apply({ geoms: patch.geoms });
    const rest = withDerived({ regions: patch.regions, countries: patch.countries, cities: patch.cities, geoms: patch.geoms });
    const r = apply({ regions: rest.regions, countries: rest.countries, cities: rest.cities, alliances: patch.alliances });
    full = { ...rest, alliances: patch.alliances };
    inv = mergeInverse(g.inv, r.inv);
    changes = { ...r.changes, geoms: true, regions: new Set([...g.changes.regions, ...r.changes.regions]) };
  } else if (opts.deferLabels && opts.group && patch.regions) {
    for (const [k, v] of Object.entries(patch.regions)) {
      const old = doc.regions[Number(k)];
      if (old?.cid) pendingLabels.add(old.cid);
      if (v?.cid) pendingLabels.add(v.cid);
    }
    full = patch;
    const r = apply(full);
    inv = r.inv;
    changes = r.changes;
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
  const doc = get().doc;
  if (pendingLabels.size && top && doc) {
    const countries = relabel(new Set(pendingLabels), doc.regions, {});
    pendingLabels.clear();
    const r = apply({ countries });
    set({ past: [...past.slice(0, -1), { ...top, group: undefined, fwd: mergeForward(top.fwd, { countries }), inv: mergeInverse(top.inv, r.inv) }] });
    emit(r.changes);
    return;
  }
  pendingLabels.clear();
  if (top?.group) set({ past: [...past.slice(0, -1), { ...top, group: undefined }] });
}

function replay(entry: HistoryEntry, patch: Patch) {
  const geomFirst = patch.geoms ? apply({ geoms: patch.geoms }) : null;
  const r = apply({ regions: patch.regions, countries: patch.countries, cities: patch.cities, alliances: patch.alliances });
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

/**
 * Rebuilds the broken shapes of a world (from older versions or other editors), filling lost
 * stretches of border along the neighbours' outlines. Returns the repaired geometry and how many
 * regions needed it.
 */
function repairWorld(geoms: Record<number, RegionGeom>): { geoms: Record<number, RegionGeom>; fixed: number } {
  const broken = Object.keys(geoms).filter((id) => geomIssues(geoms[Number(id)]).length);
  if (!broken.length) return { geoms, fixed: 0 };
  const boxes = Object.entries(geoms).map(([id, g]) => [Number(id), bbox(g)] as const);
  const out = { ...geoms };
  let fixed = 0;
  for (const k of broken) {
    const id = Number(k);
    const b = bbox(geoms[id]);
    const pad = 0.05;
    const neighbours = boxes
      .filter(([o, x]) => o !== id && x[0] <= b[2] + pad && x[2] >= b[0] - pad && x[1] <= b[3] + pad && x[3] >= b[1] - pad)
      .flatMap(([o]) => (geoms[o].type === 'Polygon' ? geoms[o].coordinates : geoms[o].coordinates.flat()));
    const g = repairGeom(geoms[id], neighbours);
    if (g) {
      console.warn(`Repaired region ${id}:`, geomIssues(geoms[id]).join('; '));
      out[id] = g;
      fixed++;
    }
  }
  if (!fixed) return { geoms, fixed };
  // A rebuilt border matches its neighbours' only roughly: snap the repaired regions and those
  // around them together (gently), so no hairline gap or overlap is left between them.
  const near = new Set<number>();
  for (const k of broken) {
    const b = bbox(out[Number(k)]);
    for (const [o, x] of boxes) if (x[0] <= b[2] && x[2] >= b[0] && x[1] <= b[3] && x[3] >= b[1]) near.add(o);
  }
  const local: Record<number, RegionGeom> = {};
  for (const id of near) local[id] = out[id];
  for (const [k, g] of Object.entries(healGeoms(local, 0.004))) out[Number(k)] = cleanGeom(g);
  return { geoms: out, fixed };
}

export function loadWorld(b: WorldBundle) {
  for (const url of Object.values(get().flagUrls)) URL.revokeObjectURL(url);
  const repaired = repairWorld(b.geoms);
  b = { ...b, geoms: repaired.geoms };
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
    help: false,
    advancedOpen: false,
    detailsOpen: false,
    flagView: null,
    galleryOpen: false,
    allianceView: null,
    zen: false,
    snap: null,
  });
  pendingLabels.clear();
  if (repaired.fixed) {
    // Saved right away (a world is not re-saved just for being opened).
    set({ geomVersion: get().geomVersion + 1 });
    toast(`Repaired ${repaired.fixed} broken region shape${repaired.fixed > 1 ? 's' : ''}`, 'ok');
  }
  emit({ regions: new Set(), countries: new Set(), cities: true, geoms: true, alliances: true, all: true });
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
  const selection = { cid: null, regions: [], city: null, ...sel };
  const empty = !selection.cid && !selection.regions.length && selection.city == null;
  set(empty ? { selection, detailsOpen: false } : { selection });
}

export function setTool(tool: Tool) {
  const { selection, doc } = get();
  // Every tool but select works on the map: get the details and world panels out of the way.
  if (tool !== 'select') set({ detailsOpen: false, worldOpen: false });
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

/** Regions whose bounding box overlaps `box` (from the world data, not from what the map has drawn). */
export function regionsInBox(box: [number, number, number, number]): number[] {
  const out: number[] = [];
  for (const [id, b] of bboxes) if (b[0] <= box[2] && b[2] >= box[0] && b[1] <= box[3] && b[3] >= box[1]) out.push(id);
  return out;
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

/**
 * Bounds of a country's main body: its largest stretch of connected land, so overseas
 * territories (French Guiana, Réunion…) don't pull the view out to the whole globe.
 */
export function countryBounds(cid: string): [number, number, number, number] | null {
  const own = regionsOf(cid);
  if (!own.length || !engine.ready) return boundsOf(own.map((r) => r.id));
  const doc = get().doc!;
  const mine = new Set(own.map((r) => r.id));
  const seen = new Set<number>();
  let best: number[] = [];
  let bestArea = -1;
  for (const { id } of own) {
    if (seen.has(id)) continue;
    const part = [id];
    seen.add(id);
    let area = 0;
    for (let i = 0; i < part.length; i++) {
      area += doc.regions[part[i]].area;
      for (const m of engine.neighbors(part[i]))
        if (mine.has(m) && !seen.has(m)) {
          seen.add(m);
          part.push(m);
        }
    }
    if (area > bestArea) {
      bestArea = area;
      best = part;
    }
  }
  return boundsOf(best);
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

export function transferRegions(ids: number[], cid: string, opts: { group?: string; label?: string; deferLabels?: boolean } = {}) {
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
  commit(opts.label ?? `Give ${n} region${n > 1 ? 's' : ''} to ${name}`, { regions }, { group: opts.group, deferLabels: opts.deferLabels });
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
  commit(`Dissolve ${c.name}`, { countries: { [cid]: null }, regions, alliances: leaveAll(cid) });
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
  commit(`${b.name} annexes ${a.name}`, { countries: { [src]: null }, regions, alliances: leaveAll(src) });
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
  const { doc } = get();
  if (!doc || line.length < 2) return 0;
  const [lx0, ly0, lx1, ly1] = bbox({ type: 'LineString', coordinates: line });
  const candidates = only ?? [...bboxes].filter(([, b]) => !(b[2] < lx0 || b[0] > lx1 || b[3] < ly0 || b[1] > ly1)).map(([id]) => id);
  const cut = cutRegions(candidates, (g) => {
    try {
      return splitGeom(g, line);
    } catch (e) {
      console.warn('split failed', e);
      return null;
    }
  });
  return Object.keys(cut).length;
}

const COMPASS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];

/**
 * Replaces regions by the pieces `cut` makes of them (null leaves a region whole), in one undo
 * step. The largest piece keeps the region's id; areas and scaling stats are shared by area.
 * `names: 'compass'` names the pieces after where they lie ("Bavaria (west)"), else "(2)", "(3)"…
 * Returns, for every region cut, the ids of its pieces.
 */
export function cutRegions(
  ids: number[],
  cut: (g: RegionGeom, r: Region) => RegionGeom[] | null,
  opts: { label?: string; group?: string; names?: 'compass' | 'number' } = {},
): Record<number, number[]> {
  const { doc, geoms } = get();
  const out: Record<number, number[]> = {};
  if (!doc) return out;
  const patch: Required<Pick<Patch, 'regions' | 'geoms'>> = { regions: {}, geoms: {} };
  let nextId = nextRegionId();
  const work: Record<number, RegionGeom> = { ...geoms };
  for (const id of ids) {
    const g = work[id];
    const r = doc.regions[id];
    if (!g || !r || out[id]) continue;
    const pieces = cut(g, r);
    if (!pieces || pieces.length < 2) continue;
    pieces.sort((a, b) => geomArea(b) - geomArea(a));
    const areas = pieces.map(geomArea);
    const total = areas.reduce((a, b) => a + b, 0) || 1;
    const share = (k: number) => (r.vals ? Object.fromEntries(Object.entries(r.vals).map(([key, v]) => [key, v * k])) : undefined);
    const lps = pieces.map((p) => labelPoint(p) ?? ([r.cx, r.cy] as LngLat));
    // Compass names from the middle of the pieces: "(west)", "(east)"; numbers if two agree.
    let names = pieces.map((_, i) => (i ? `${r.name} (${i + 1})` : r.name));
    if (opts.names === 'compass') {
      const mx = lps.reduce((t, p) => t + p[0], 0) / lps.length;
      const my = lps.reduce((t, p) => t + p[1], 0) / lps.length;
      const angle = ([x, y]: LngLat) => (Math.atan2(y - my, (x - mx) * Math.cos((my * Math.PI) / 180)) * 180) / Math.PI + 360;
      // Four directions when they tell the pieces apart, else eight.
      for (const n of [4, 8]) {
        const dirs = lps.map((p) => COMPASS[((Math.round(angle(p) / (360 / n)) % n) * 8) / n]);
        if (new Set(dirs).size === dirs.length) {
          names = dirs.map((d) => `${r.name} (${d})`);
          break;
        }
      }
    }
    const pids = pieces.map((_, i) => (i ? nextId++ : id));
    pieces.forEach((p, i) => {
      patch.geoms[pids[i]] = p;
      work[pids[i]] = p;
      // Areas are shares of the stored area so totals never drift.
      patch.regions[pids[i]] = { ...r, id: pids[i], name: names[i], area: (r.area * areas[i]) / total, cx: lps[i][0], cy: lps[i][1], vals: share(areas[i] / total) };
    });
    out[id] = pids;
    // Neighbours (and the pieces of neighbours cut just before) get the new border vertices.
    const nb: Record<number, RegionGeom> = {};
    for (const n of engine.neighbors(id)) for (const m of out[n] ?? [n]) if (work[m]) nb[m] = work[m];
    for (const [k, v] of Object.entries(insertCutVertices(pieces, g, nb))) {
      patch.geoms[Number(k)] = v;
      work[Number(k)] = v;
    }
  }
  const n = Object.keys(out).length;
  if (n) commit(opts.label ?? `Split ${n} region${n > 1 ? 's' : ''}`, patch, { group: opts.group });
  return out;
}

export function mergeRegions(ids: number[]): number | null {
  const doc = get().doc!;
  const rs = ids.map((id) => doc.regions[id]).filter(Boolean);
  if (rs.length < 2) return null;
  const merged = engine.merge(rs.map((r) => r.id));
  const keep = rs.reduce((a, b) => (b.area > a.area ? b : a));
  let geom: RegionGeom | null = merged && (merged.coordinates.length === 1 ? { type: 'Polygon', coordinates: merged.coordinates[0] } : merged);
  // The arc merge needs borders that match point for point; when it cannot close an outline,
  // fall back to a true union of the shapes.
  if (!geom || geomIssues(geom).length) geom = unionGeoms(rs.map((r) => get().geoms[r.id]).filter(Boolean));
  if (!geom) return null;
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

// ── Alliances ────────────────────────────────────────────────────────────────

/** Patch taking a country out of every alliance it belongs to. */
function leaveAll(cid: string): Record<string, Alliance> {
  const out: Record<string, Alliance> = {};
  for (const a of get().doc?.alliances ?? []) if (a.members.includes(cid)) out[a.id] = { ...a, members: a.members.filter((m) => m !== cid) };
  return out;
}

const ALLIANCE_COLORS = ['#2F6FDE', '#D9363E', '#1E9E6A', '#E08A12', '#8A4FD8', '#0FA3B1', '#C2417A', '#6B7A1F'];

export function createAlliance(name: string, members: string[] = []): string {
  const doc = get().doc!;
  const used = new Set(doc.alliances.map((a) => a.color.toUpperCase()));
  const color = ALLIANCE_COLORS.find((c) => !used.has(c)) ?? ALLIANCE_COLORS[doc.alliances.length % ALLIANCE_COLORS.length];
  const id = uid();
  commit(`Found ${name}`, { alliances: { [id]: { id, name, color, members } } });
  return id;
}

export function updateAlliance(id: string, changes: Partial<Alliance>, label = 'Edit alliance') {
  const a = get().doc?.alliances.find((x) => x.id === id);
  if (!a) return;
  commit(label, { alliances: { [id]: { ...a, ...changes } } }, { group: `alliance:${id}:${Object.keys(changes).join(',')}` });
}

export function deleteAlliance(id: string) {
  const a = get().doc?.alliances.find((x) => x.id === id);
  if (!a) return;
  commit(`Disband ${a.name}`, { alliances: { [id]: null } });
  if (get().allianceView === id) set({ allianceView: 'all' });
}

/** Adds a country to an alliance, or takes it out. */
export function setMember(id: string, cid: string, member: boolean) {
  const doc = get().doc;
  const a = doc?.alliances.find((x) => x.id === id);
  const c = doc?.countries[cid];
  if (!a || !c || a.members.includes(cid) === member) return;
  const members = member ? [...a.members, cid] : a.members.filter((m) => m !== cid);
  commit(member ? `${c.name} joins ${a.name}` : `${c.name} leaves ${a.name}`, { alliances: { [id]: { ...a, members } } });
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
