// The real areas of a city (its quarters and the towns right next to it), collected the first time
// the city is opened and kept on the device: opening it again asks nothing of the network.
import type { City } from '../types';
import { fetchNeighbours, fetchTown, fetchTownAt, type Candidate } from './osm';
import { loadAreas, saveAreas } from './db';

const memory = new Map<string, Candidate[]>();
const pending = new Map<string, Promise<Candidate[]>>();

/** Cities a few hundred metres apart share what was collected. */
const keyOf = (c: City) => `${c.lng.toFixed(2)},${c.lat.toFixed(2)}`;

/** The areas around a city: from memory, else from the device, else from OpenStreetMap (then kept). */
export function areasAround(c: City): Promise<Candidate[]> {
  const key = keyOf(c);
  const known = memory.get(key);
  if (known) return Promise.resolve(known);
  let p = pending.get(key);
  if (!p) {
    p = (async () => {
      const stored = await loadAreas(key).catch(() => undefined);
      const areas = stored ?? (await fetchTown([c.lng, c.lat]));
      memory.set(key, areas);
      // An empty answer is not kept: the map may know the place better another day.
      if (!stored && areas.length) void saveAreas(key, areas).catch(() => {});
      return areas;
    })().finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

/** Adds newly found areas to what is known around the city (and kept on the device). */
function merge(c: City, more: Candidate[]): Candidate[] {
  const key = keyOf(c);
  const known = memory.get(key) ?? [];
  const have = new Set(known.map((a) => a.id));
  const fresh = more.filter((a) => !have.has(a.id));
  if (!fresh.length) return known;
  const all = [...known, ...fresh];
  memory.set(key, all);
  void saveAreas(key, all).catch(() => {});
  return all;
}

/** Areas whose neighbours were already asked for. */
const grown = new Set<string>();

/**
 * A town taken into the city brings the towns that touch it within reach: the city grows ring
 * after ring. Null when there is nothing new to ask (a quarter, or a town already grown from).
 */
export async function growFrom(c: City, area: Candidate): Promise<Candidate[] | null> {
  const tag = `${keyOf(c)}:${area.id}`;
  if (area.level > 8 || grown.has(tag)) return null;
  grown.add(tag);
  try {
    return merge(c, await fetchNeighbours(area));
  } catch (err) {
    grown.delete(tag);
    throw err;
  }
}

/** The town at a spot nothing is known about yet, with its neighbours. */
export async function growAt(c: City, at: [number, number]): Promise<{ town: Candidate | null; areas: Candidate[] }> {
  const found = await fetchTownAt(at);
  const areas = merge(c, found.areas);
  if (found.town) grown.add(`${keyOf(c)}:${found.town}`);
  return { town: areas.find((a) => a.id === found.town) ?? null, areas };
}
