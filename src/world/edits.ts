// World-building edits beyond owning land: hand-drawn marks, occupations, states, vassals,
// new land, deleting regions, label placement and find & replace. Each is one undo step.
import type { Country, CountryState, LngLat, Mark, Patch, Region, RegionGeom } from '../types';
import { useWorld, commit, select, nextRegionId, toast, regionsOf } from './store';
import { carveLand } from '../geo/split';
import { geomArea, labelPoint } from '../geo/engine';
import { uid } from '../util';

const get = useWorld.getState;

// ── Marks: lines, names and pins drawn by hand ───────────────────────────────

export function addMark(mark: Mark, label?: string): string {
  commit(label ?? `Add ${markNoun(mark)}`, { marks: { [mark.id]: mark } });
  return mark.id;
}

export function updateMark(id: string, changes: Partial<Mark>, label = 'Edit') {
  const m = get().doc?.marks?.[id];
  if (!m) return;
  commit(`${label} ${markNoun(m)}`, { marks: { [id]: { ...m, ...changes } as Mark } }, { group: `mark:${id}:${Object.keys(changes).join(',')}` });
}

export function deleteMark(id: string) {
  const m = get().doc?.marks?.[id];
  if (!m) return;
  commit(`Delete ${markNoun(m)}`, { marks: { [id]: null } });
  if (get().markSel === id) useWorld.setState({ markSel: null });
}

export function markNoun(m: Mark): string {
  if (m.type === 'label') return 'name';
  if (m.type === 'pin') return 'pin';
  return LINE_KINDS[m.kind].noun;
}

export const LINE_KINDS = {
  road: { label: 'Road', noun: 'road', color: '#8a5a2b' },
  rail: { label: 'Railway', noun: 'railway', color: '#3a3f4b' },
  route: { label: 'Trade route', noun: 'trade route', color: '#c9821a' },
  sea: { label: 'Sea lane', noun: 'sea lane', color: '#1f6fb8' },
  front: { label: 'Front line', noun: 'front line', color: '#d0312d' },
  border: { label: 'Claimed border', noun: 'claimed border', color: '#7a3fb8' },
} as const;

export const LABEL_KINDS = {
  sea: { label: 'Sea / ocean', size: 18 },
  land: { label: 'Land / region', size: 16 },
  mountains: { label: 'Mountains', size: 14 },
  note: { label: 'Note', size: 13 },
} as const;

export const newMarkId = () => uid().slice(0, 12);

// ── Occupation ───────────────────────────────────────────────────────────────

/** Puts regions under occupation by `occ` (null ends it). The owner keeps its claim. */
export function setOccupation(ids: number[], occ: string | null) {
  const doc = get().doc!;
  const regions: Record<number, Region> = {};
  for (const id of ids) {
    const r = doc.regions[id];
    if (!r || !r.cid) continue;
    if (occ && occ !== r.cid && r.occ !== occ) regions[id] = { ...r, occ };
    else if ((!occ || occ === r.cid) && r.occ) {
      const next = { ...r };
      delete next.occ;
      regions[id] = next;
    }
  }
  const n = Object.keys(regions).length;
  if (!n) return 0;
  const who = occ ? doc.countries[occ]?.name ?? occ : null;
  commit(who ? `${who} occupies ${n} region${n > 1 ? 's' : ''}` : `End occupation of ${n} region${n > 1 ? 's' : ''}`, { regions });
  return n;
}

/** Regions a country occupies abroad, and its own regions others occupy. */
export function occupationsOf(cid: string): { holds: Region[]; lost: Region[] } {
  const holds: Region[] = [];
  const lost: Region[] = [];
  for (const r of Object.values(get().doc?.regions ?? {})) {
    if (r.occ === cid) holds.push(r);
    else if (r.cid === cid && r.occ) lost.push(r);
  }
  return { holds, lost };
}

// ── States (subdivisions) ────────────────────────────────────────────────────

const STATE_TINTS = ['#ffffff', '#000000'];

/** Creates a state of `cid` from some of its regions. */
export function createState(cid: string, name: string, ids: number[] = []): string | null {
  const doc = get().doc!;
  const c = doc.countries[cid];
  if (!c) return null;
  const key = uid().slice(0, 8);
  const st: CountryState = { name };
  const regions: Record<number, Region> = {};
  for (const id of ids) if (doc.regions[id]?.cid === cid) regions[id] = { ...doc.regions[id], state: key };
  commit(`Found the state of ${name}`, { countries: { [cid]: { ...c, states: { ...c.states, [key]: st } } }, regions });
  return key;
}

export function updateState(cid: string, key: string, changes: Partial<CountryState>) {
  const c = get().doc?.countries[cid];
  const st = c?.states?.[key];
  if (!c || !st) return;
  commit(`Edit ${st.name}`, { countries: { [cid]: { ...c, states: { ...c.states, [key]: { ...st, ...changes } } } } }, { group: `state:${cid}:${key}:${Object.keys(changes).join(',')}` });
}

export function deleteState(cid: string, key: string) {
  const c = get().doc?.countries[cid];
  const st = c?.states?.[key];
  if (!c || !st) return;
  const states = { ...c.states };
  delete states[key];
  const regions: Record<number, Region> = {};
  for (const r of regionsOf(cid))
    if (r.state === key) {
      const next = { ...r };
      delete next.state;
      regions[r.id] = next;
    }
  commit(`Dissolve ${st.name}`, { countries: { [cid]: { ...c, states } }, regions });
}

/** Puts regions in a state of their owner (null takes them out of any). */
export function assignState(ids: number[], key: string | null) {
  const doc = get().doc!;
  const regions: Record<number, Region> = {};
  for (const id of ids) {
    const r = doc.regions[id];
    if (!r || !r.cid) continue;
    if (key && doc.countries[r.cid]?.states?.[key] && r.state !== key) regions[id] = { ...r, state: key };
    else if (!key && r.state) {
      const next = { ...r };
      delete next.state;
      regions[id] = next;
    }
  }
  const n = Object.keys(regions).length;
  if (n) commit(key ? `Move ${n} region${n > 1 ? 's' : ''} into a state` : `Take ${n} region${n > 1 ? 's' : ''} out of their state`, { regions });
  return n;
}

/** Colour of a state: its own, or the country's colour shaded a little differently for each one. */
export function stateColor(c: Country, key: string): string {
  const own = c.states?.[key]?.color;
  if (own) return own;
  const keys = Object.keys(c.states ?? {});
  const i = keys.indexOf(key);
  if (i < 0) return c.color;
  const tint = STATE_TINTS[i % 2];
  const amount = 0.1 + 0.08 * Math.floor(i / 2);
  return mix(c.color, tint, Math.min(0.42, amount));
}

export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h);
    return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [200, 200, 200];
  };
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// ── Vassals ──────────────────────────────────────────────────────────────────

/** Makes `cid` a vassal of `overlord` (null frees it). Refuses loops (A over B over A). */
export function setOverlord(cid: string, overlord: string | null) {
  const doc = get().doc!;
  const c = doc.countries[cid];
  if (!c || (c.overlord ?? null) === overlord) return;
  if (overlord) {
    for (let o: string | undefined = overlord, n = 0; o && n < 100; o = doc.countries[o]?.overlord, n++)
      if (o === cid) return toast(`${doc.countries[overlord]?.name} already answers to ${c.name}`, 'error');
  }
  const next = { ...c };
  if (overlord) next.overlord = overlord;
  else delete next.overlord;
  const lord = overlord ? doc.countries[overlord]?.name : null;
  commit(lord ? `${c.name} becomes a vassal of ${lord}` : `${c.name} breaks free`, { countries: { [cid]: next } });
}

export function vassalsOf(cid: string): Country[] {
  return Object.values(get().doc?.countries ?? {}).filter((c) => c.overlord === cid);
}

/** The top of a country's chain of overlords (itself when free). */
export function realmOf(cid: string): string {
  const doc = get().doc;
  let cur = cid;
  for (let n = 0; n < 100; n++) {
    const up = doc?.countries[cur]?.overlord;
    if (!up || !doc?.countries[up]) return cur;
    cur = up;
  }
  return cur;
}

// ── New land, deleting regions ───────────────────────────────────────────────

/**
 * Turns a drawn outline into a new region (the part that isn't land yet), owned by `cid`.
 * `quiet` neither selects it nor complains when the outline is all land; `group` makes it
 * part of a larger undo step.
 */
export function addLand(outline: LngLat[], cid: string, opts: { group?: string; quiet?: boolean; label?: string } = {}): number | null {
  const { doc, geoms } = get();
  if (!doc) return null;
  const carved = carveLand(outline, geoms);
  if (!carved) {
    if (!opts.quiet) toast('Draw the outline over the sea: this is land already', 'error');
    return null;
  }
  const id = nextRegionId();
  const lp = labelPoint(carved.geom) ?? outline[0];
  const owner = cid && doc.countries[cid] ? cid : '';
  const patch: Patch = {
    geoms: { ...carved.neighbours, [id]: carved.geom },
    regions: { [id]: { id, name: newLandName(), cid: owner, area: geomArea(carved.geom), cx: lp[0], cy: lp[1] } },
  };
  commit(opts.label ?? `Raise new land${owner ? ` for ${doc.countries[owner].name}` : ''}`, patch, { group: opts.group });
  if (!opts.quiet) select({ cid: owner || null, regions: [id] });
  return id;
}

function newLandName(): string {
  const doc = get().doc!;
  const taken = new Set(Object.values(doc.regions).map((r) => r.name));
  for (let i = 1; ; i++) {
    const n = i === 1 ? 'New Land' : `New Land ${i}`;
    if (!taken.has(n)) return n;
  }
}

/** Sinks regions into the sea. Cities on them stay (as they do when land changes hands). */
export function deleteRegions(ids: number[]) {
  const doc = get().doc!;
  const regions: Record<number, null> = {};
  const geoms: Record<number, RegionGeom | null> = {};
  for (const id of ids)
    if (doc.regions[id]) {
      regions[id] = null;
      geoms[id] = null;
    }
  const n = Object.keys(regions).length;
  if (!n) return;
  if (n >= Object.keys(doc.regions).length) return toast('A world needs at least one region', 'error');
  commit(`Sink ${n === 1 ? doc.regions[ids[0]].name : `${n} regions`}`, { regions, geoms });
  select({});
}

// ── Labels ───────────────────────────────────────────────────────────────────

/** Places a country's name by hand; it then stays put when its borders change. */
export function moveLabel(cid: string, at: LngLat) {
  const c = get().doc?.countries[cid];
  if (!c) return;
  commit(`Move the name of ${c.name}`, { countries: { [cid]: { ...c, label: [+at[0].toFixed(4), +at[1].toFixed(4)], labelFixed: true } } });
}

/** Lets the name find its own place again. */
export function resetLabel(cid: string) {
  const doc = get().doc;
  const c = doc?.countries[cid];
  if (!c) return;
  const next = { ...c };
  delete next.labelFixed;
  // Committing a region patch recomputes free labels: touch one region of the country.
  const r = regionsOf(cid)[0];
  commit(`Place the name of ${c.name} automatically`, { countries: { [cid]: next }, ...(r ? { regions: { [r.id]: { ...r } } } : {}) });
}

// ── Find & replace ───────────────────────────────────────────────────────────

export interface FindScope {
  countries: boolean;
  regions: boolean;
  cities: boolean;
  fields: boolean;
  notes: boolean;
  marks: boolean;
}

export interface FindHit {
  where: string;
  before: string;
  after: string;
}

function pattern(find: string, opts: { matchCase: boolean; wholeWord: boolean }): RegExp | null {
  if (!find) return null;
  const esc = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(opts.wholeWord ? `(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])` : esc, 'gu' + (opts.matchCase ? '' : 'i'));
}

/** Every text that `find` would change, and the patch that changes them. */
export function findReplace(find: string, repl: string, scope: FindScope, opts: { matchCase: boolean; wholeWord: boolean }): { hits: FindHit[]; patch: Patch } {
  const doc = get().doc;
  const hits: FindHit[] = [];
  const patch: Patch = {};
  const re = pattern(find, opts);
  if (!doc || !re) return { hits, patch };
  const sub = (s: string | undefined) => (s && s.search(re) >= 0 ? s.replace(re, repl) : null);
  const hit = (where: string, before: string, after: string) => hits.push({ where, before, after });

  for (const c of Object.values(doc.countries)) {
    let next: Country | null = null;
    const edit = () => (next ??= { ...c, fields: { ...c.fields }, states: c.states ? { ...c.states } : undefined });
    if (scope.countries) {
      const n = sub(c.name);
      if (n != null) {
        edit().name = n;
        hit('Country', c.name, n);
      }
      for (const [k, st] of Object.entries(c.states ?? {})) {
        const sn = sub(st.name);
        if (sn != null) {
          edit().states![k] = { ...st, name: sn };
          hit(`State of ${c.name}`, st.name, sn);
        }
      }
    }
    if (scope.fields)
      for (const [k, v] of Object.entries(c.fields)) {
        const n = sub(v);
        if (n != null) {
          edit().fields[k] = n;
          hit(`${k} · ${c.name}`, v, n);
        }
      }
    if (scope.notes) {
      const n = sub(c.notes);
      if (n != null) {
        edit().notes = n;
        hit(`Notes · ${c.name}`, c.notes!, n);
      }
    }
    if (next) (patch.countries ??= {})[c.cid] = next;
  }
  for (const r of Object.values(doc.regions)) {
    let next: Region | null = null;
    if (scope.regions) {
      const n = sub(r.name);
      if (n != null) {
        next = { ...r, name: n };
        hit('Region', r.name, n);
      }
    }
    if (scope.notes) {
      const n = sub(r.notes);
      if (n != null) {
        next = { ...(next ?? r), notes: n };
        hit(`Notes · ${r.name}`, r.notes!, n);
      }
    }
    if (next) (patch.regions ??= {})[r.id] = next;
  }
  for (const c of Object.values(doc.cities)) {
    let next = null as typeof c | null;
    if (scope.cities) {
      const n = sub(c.name);
      if (n != null) {
        next = { ...c, name: n };
        hit('City', c.name, n);
      }
    }
    if (scope.notes) {
      const n = sub(c.notes);
      if (n != null) {
        next = { ...(next ?? c), notes: n };
        hit(`Notes · ${c.name}`, c.notes!, n);
      }
    }
    if (next) (patch.cities ??= {})[c.id] = next;
  }
  if (scope.marks)
    for (const m of Object.values(doc.marks ?? {})) {
      const text = m.type === 'label' ? m.text : m.name;
      const n = sub(text);
      if (n == null) continue;
      (patch.marks ??= {})[m.id] = (m.type === 'label' ? { ...m, text: n } : { ...m, name: n }) as Mark;
      hit(markNoun(m)[0].toUpperCase() + markNoun(m).slice(1), text, n);
    }
  return { hits, patch };
}

export function applyFindReplace(find: string, repl: string, scope: FindScope, opts: { matchCase: boolean; wholeWord: boolean }): number {
  const { hits, patch } = findReplace(find, repl, scope, opts);
  if (hits.length) commit(`Replace “${find}” with “${repl}” (${hits.length})`, patch);
  return hits.length;
}
