// The real areas of a city (its quarters and the towns right next to it), collected the first time
// the city is opened and kept on the device: opening it again asks nothing of the network.
import type { City } from '../types';
import { fetchTown, type Candidate } from './osm';
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
