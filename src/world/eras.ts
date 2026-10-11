import type { Country, Era, EraCountry, Patch, Region, WorldDoc } from '../types';

// The timeline's pure parts: taking a chapter from a world, showing a world as a chapter knew
// it, and bringing a world back to one. (The actions on the open world are in timeline.ts.)

/** Chapters in the order they are shown. */
export function sortedEras(doc: WorldDoc | null | undefined): Era[] {
  return [...(doc?.timeline ?? [])].sort((a, b) => a.order - b.order);
}

/** Region id → owner, as a chapter knew it. */
export function ownerIndex(era: Era): Map<number, string> {
  const out = new Map<number, string>();
  for (const [cid, ids] of Object.entries(era.own)) for (const id of ids) out.set(id, cid);
  return out;
}

function eraCountry(c: Country): EraCountry {
  const out: EraCountry = { cid: c.cid, name: c.name, color: c.color };
  if (c.flag) out.flag = c.flag;
  if (c.capital != null) out.capital = c.capital;
  if (c.label) out.label = c.label;
  if (c.labelFixed) out.labelFixed = true;
  if (c.colorMode) out.colorMode = c.colorMode;
  if (c.gradient) out.gradient = c.gradient;
  if (c.overlord) out.overlord = c.overlord;
  return out;
}

/** Who owns and occupies what in `doc`, and the countries holding land (or vassals). */
export function captureEra(doc: WorldDoc, base: Pick<Era, 'id' | 'name' | 'date' | 'order' | 'notes'>): Era {
  const own: Record<string, number[]> = {};
  const occ: Record<number, string> = {};
  for (const r of Object.values(doc.regions)) {
    if (!r.cid) continue;
    (own[r.cid] ??= []).push(r.id);
    if (r.occ) occ[r.id] = r.occ;
  }
  const countries: Record<string, EraCountry> = {};
  const keep = new Set(Object.keys(own));
  // Overlords and occupiers are part of the picture even when they hold no land of their own.
  for (const c of Object.values(doc.countries)) if (c.overlord && keep.has(c.cid)) keep.add(c.overlord);
  for (const cid of Object.values(occ)) keep.add(cid);
  for (const cid of keep) if (doc.countries[cid]) countries[cid] = eraCountry(doc.countries[cid]);
  const era: Era = { ...base, own, countries };
  if (Object.keys(occ).length) era.occ = occ;
  return era;
}

/**
 * The world as a chapter knew it, on today's land: owners, occupations and countries (names,
 * colours, flags) come from the chapter; figures, lore, cities and drawings stay today's.
 * Land the chapter never heard of (raised since) is unclaimed, countries born since are absent.
 */
export function eraDoc(present: WorldDoc, era: Era): WorldDoc {
  const owner = ownerIndex(era);
  const regions: Record<number, Region> = {};
  for (const r of Object.values(present.regions)) {
    const known = owner.get(r.id);
    const cid = known && era.countries[known] ? known : '';
    const occ = cid && era.occ?.[r.id] && era.countries[era.occ[r.id]] ? era.occ[r.id] : undefined;
    if (cid === r.cid && occ === r.occ) {
      regions[r.id] = r;
      continue;
    }
    const next: Region = { ...r, cid };
    if (occ) next.occ = occ;
    else delete next.occ;
    // States belong to the owner the region has today.
    if (cid !== r.cid) delete next.state;
    regions[r.id] = next;
  }
  const countries: Record<string, Country> = {};
  for (const ec of Object.values(era.countries)) {
    const now = present.countries[ec.cid];
    const c: Country = { cid: ec.cid, name: ec.name, color: ec.color, stats: now?.stats ?? {}, fields: now?.fields ?? {} };
    if (now?.notes) c.notes = now.notes;
    if (now?.states) c.states = now.states;
    if (ec.flag) c.flag = ec.flag;
    if (ec.capital != null && present.cities[ec.capital]) c.capital = ec.capital;
    if (ec.label) c.label = ec.label;
    if (ec.labelFixed) c.labelFixed = true;
    if (ec.colorMode) c.colorMode = ec.colorMode;
    if (ec.gradient) c.gradient = ec.gradient;
    if (ec.overlord && era.countries[ec.overlord]) c.overlord = ec.overlord;
    countries[ec.cid] = c;
  }
  const alliances = present.alliances.map((a) => (a.members.every((m) => countries[m]) ? a : { ...a, members: a.members.filter((m) => countries[m]) }));
  return { ...present, regions, countries, alliances };
}

/**
 * When regions are cut, every chapter gives the pieces to whoever held the region then.
 * `pieces`: region id → ids of what it became (itself included). Returns the chapters that change.
 */
export function inheritPieces(eras: Era[], pieces: Record<number, number[]>): Record<string, Era> {
  const out: Record<string, Era> = {};
  for (const era of eras) {
    const owner = ownerIndex(era);
    let own: Record<string, number[]> | null = null;
    let occ: Record<number, string> | null = null;
    for (const [k, pids] of Object.entries(pieces)) {
      const id = Number(k);
      const cid = owner.get(id);
      if (!cid) continue;
      const fresh = pids.filter((p) => p !== id && !owner.has(p));
      if (!fresh.length) continue;
      own ??= { ...era.own };
      own[cid] = [...own[cid], ...fresh];
      const holder = era.occ?.[id];
      if (holder) {
        occ ??= { ...era.occ };
        for (const p of fresh) occ[p] = holder;
      }
    }
    if (own) out[era.id] = { ...era, own, ...(occ ? { occ } : {}) };
  }
  return out;
}

/** The changes that bring `doc` back to a chapter: land, occupations, and the countries of the time. */
export function restorePatch(doc: WorldDoc, era: Era): Patch {
  const then = eraDoc(doc, era);
  const regions: Record<number, Region> = {};
  for (const r of Object.values(then.regions)) if (r !== doc.regions[r.id]) regions[r.id] = r;
  const countries: Record<string, Country> = {};
  for (const c of Object.values(then.countries)) {
    const now = doc.countries[c.cid];
    if (!now || JSON.stringify(eraCountry(now)) !== JSON.stringify(eraCountry(c))) countries[c.cid] = c;
  }
  // A capital goes with its country: the cities' crowns follow.
  const cities: Patch['cities'] = {};
  for (const c of Object.values(countries)) {
    const was = doc.countries[c.cid]?.capital;
    if (was === c.capital) continue;
    if (was != null && doc.cities[was]) cities[was] = { ...doc.cities[was], capital: false };
    if (c.capital != null && doc.cities[c.capital]) cities[c.capital] = { ...doc.cities[c.capital], capital: true };
  }
  const patch: Patch = {};
  if (Object.keys(regions).length) patch.regions = regions;
  if (Object.keys(countries).length) patch.countries = countries;
  if (Object.keys(cities).length) patch.cities = cities;
  return patch;
}

export interface EraChange {
  cid: string;
  name: string;
  color: string;
  /** km² gained (positive) or lost. */
  delta: number;
  /** The country appears or disappears between the two. */
  kind?: 'born' | 'gone';
}

/** Who gained and lost land between two moments of `doc` (each a chapter, or null for today), biggest first. */
export function eraChanges(doc: WorldDoc, from: Era | null, to: Era | null): EraChange[] {
  const areas = (era: Era | null) => {
    const out: Record<string, number> = {};
    if (!era) {
      for (const r of Object.values(doc.regions)) if (r.cid) out[r.cid] = (out[r.cid] ?? 0) + r.area;
      return out;
    }
    for (const [cid, ids] of Object.entries(era.own)) {
      let a = 0;
      let any = false;
      for (const id of ids)
        if (doc.regions[id]) {
          a += doc.regions[id].area;
          any = true;
        }
      if (any) out[cid] = a;
    }
    return out;
  };
  const a = areas(from);
  const b = areas(to);
  const who = (cid: string) => to?.countries[cid] ?? (to ? undefined : doc.countries[cid]) ?? from?.countries[cid] ?? doc.countries[cid];
  const out: EraChange[] = [];
  for (const cid of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const delta = (b[cid] ?? 0) - (a[cid] ?? 0);
    const kind = !(cid in a) ? 'born' : !(cid in b) ? 'gone' : undefined;
    if (!kind && Math.abs(delta) < 1) continue;
    const c = who(cid);
    out.push({ cid, name: c?.name ?? cid, color: c?.color ?? '#999999', delta, kind });
  }
  return out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}
