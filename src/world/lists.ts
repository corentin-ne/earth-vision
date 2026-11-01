// Readable plain-text lists of a country (its regions, its cities, the real places its land
// was made from), to copy out of the app. Also how a region remembers its real-world origin.
import type { City, Region, WorldDoc } from '../types';
import { fmtInt } from '../util';

const PART = /\s\((?:part|east|west|north|south|north-east|north-west|south-east|south-west)\)$/;

/** The real-world areas a region was made from (its own name until renamed, split or merged). */
export function realOf(r: Region): string[] {
  return r.real ?? [r.name];
}

/** What a piece of `r` came from: "Haut-Rhin (west)", or "Haut-Rhin (part)" once cut again. */
export function pieceReal(r: Region, dir?: string): string[] {
  return realOf(r).map((n) => (PART.test(n) ? n.replace(PART, ' (part)') : `${n} (${dir ?? 'part'})`));
}

/** What regions merged into one came from, without repeats ("X (west)" + "X (east)" → "X"). */
export function mergeReal(rs: Region[]): string[] {
  const all = [...new Set(rs.flatMap(realOf))];
  const bases = new Map<string, string[]>();
  for (const n of all) {
    const b = n.replace(PART, '');
    bases.set(b, [...(bases.get(b) ?? []), n]);
  }
  const out: string[] = [];
  for (const [b, ns] of bases) {
    // Two or more pieces of the same place, or the place and a piece of it: name the place.
    if (ns.length > 1 || all.includes(b)) out.push(b);
    else out.push(ns[0]);
  }
  return out;
}

/** Keeps the real-world origin when a region is renamed. */
export function renamed(r: Region, name: string): Region {
  return { ...r, real: realOf(r), name };
}

/** The world was made from the real Earth, so "real world" means something. */
export function isEarthWorld(doc: WorldDoc): boolean {
  return doc.meta.source === 'earth' || doc.meta.source === 'blank' || Object.values(doc.regions).some((r) => r.real);
}

/** One line: "Haut-Rhin + Palatinate (west)", or "new land" for land raised from the sea. */
export function realLine(r: Region): string {
  const real = realOf(r);
  return real.length ? real.join(' + ') : 'new land';
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

function regionsOf(doc: WorldDoc, cid: string): Region[] {
  return Object.values(doc.regions)
    .filter((r) => r.cid === cid)
    .sort(byName);
}

/** Regions grouped by state when the country has states, else in one alphabetical list. */
function grouped(doc: WorldDoc, cid: string, line: (r: Region) => string): string[] {
  const c = doc.countries[cid];
  const rs = regionsOf(doc, cid);
  const states = c?.states ?? {};
  if (!Object.keys(states).length) return rs.map(line);
  const out: string[] = [];
  const keys = Object.keys(states).sort((a, b) => states[a].name.localeCompare(states[b].name));
  for (const k of [...keys, '']) {
    const in_ = rs.filter((r) => (k ? r.state === k : !r.state || !states[r.state]));
    if (!in_.length) continue;
    if (out.length) out.push('');
    out.push(`${k ? states[k].name : 'No state'} (${in_.length})`);
    for (const r of in_) out.push(`  ${line(r)}`);
  }
  return out;
}

export function regionList(doc: WorldDoc, cid: string): string {
  const c = doc.countries[cid];
  const n = regionsOf(doc, cid).length;
  return [`${c?.name ?? cid} — ${n} region${n === 1 ? '' : 's'}`, '', ...grouped(doc, cid, (r) => r.name)].join('\n');
}

/** The real places, one line per region: "Alsace = Haut-Rhin + Bas-Rhin" when renamed or reshaped. */
export function realList(doc: WorldDoc, cid: string): string {
  const c = doc.countries[cid];
  const rs = regionsOf(doc, cid);
  const places = [...new Set(rs.flatMap(realOf).map((n) => n.replace(PART, '')))].sort((a, b) => a.localeCompare(b));
  const line = (r: Region) => {
    const real = realLine(r);
    return real === r.name ? r.name : `${r.name} = ${real}`;
  };
  return [
    `${c?.name ?? cid} in the real world — ${places.length} place${places.length === 1 ? '' : 's'}`,
    '',
    ...grouped(doc, cid, line),
    '',
    'Real places (whole or in part):',
    places.join(', ') || '—',
  ].join('\n');
}

/** Cities, biggest first; the capital first of all. */
export function cityList(doc: WorldDoc, cid: string, owners: Record<number, string>): string {
  const c = doc.countries[cid];
  const cities = Object.values(doc.cities)
    .filter((x) => owners[x.id] === cid)
    .sort((a, b) => Number(b.id === c?.capital) - Number(a.id === c?.capital) || (b.pop ?? 0) - (a.pop ?? 0) || a.name.localeCompare(b.name));
  const line = (x: City) => `${x.name}${x.id === c?.capital ? ' (capital)' : ''}${x.pop ? ` — ${fmtInt(x.pop)}` : ''}`;
  return [`${c?.name ?? cid} — ${cities.length} cit${cities.length === 1 ? 'y' : 'ies'}`, '', ...cities.map(line)].join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older webviews: a hidden text box and the copy command.
    const t = document.createElement('textarea');
    t.value = text;
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}
