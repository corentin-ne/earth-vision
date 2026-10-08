// "Fantasy Earth": today's land carved into made-up nations that grow outward from
// random seeds, with names, colours and capitals. Deterministic for a given seed.
import type { Country, Region, WorldBundle } from '../types';
import { GeoEngine, bbox, pointInGeom } from '../geo/engine';
import { countryName, seeded } from './names';
import { uid } from '../util';

export interface FantasyOptions {
  /** Roughly how many nations to create. */
  nations: number;
  seed: number;
}

/** Re-deals the regions of `earth` (a claimed Earth bundle) between invented nations. */
export function fantasyEarth(earth: WorldBundle, { nations, seed }: FantasyOptions): WorldBundle {
  const rand = seeded(seed);
  const regions = earth.doc.regions;
  const ids = Object.keys(regions).map(Number);
  const engine = new GeoEngine();
  engine.build(earth.geoms);

  const owner = new Map<number, number>(); // region → nation index
  const strength: number[] = [];
  const heap = new MinHeap();

  const addNation = (rid: number) => {
    const n = strength.length;
    strength.push(0.55 + rand() * 1.1); // stronger nations spread further
    heap.push(0, rid, n);
    return n;
  };
  // Dijkstra-like growth: entering a region costs its area, divided by the nation's strength.
  const grow = () => {
    for (let e = heap.pop(); e; e = heap.pop()) {
      const [cost, rid, n] = e;
      if (owner.has(rid)) continue;
      owner.set(rid, n);
      for (const nb of engine.neighbors(rid)) {
        if (owner.has(nb) || !regions[nb]) continue;
        heap.push(cost + (regions[nb].area * (0.6 + rand() * 0.8)) / strength[n], nb, n);
      }
    }
  };

  // Seeds are picked in proportion to area so they spread over the land rather than
  // piling up where regions are small (Europe, islands).
  const weights = ids.map((id) => Math.pow(regions[id].area, 0.75));
  let total = weights.reduce((s, w) => s + w, 0);
  const taken = new Set<number>();
  for (let k = 0; k < nations && taken.size < ids.length; k++) {
    let r = rand() * total;
    let i = 0;
    while (i < ids.length - 1 && (r -= weights[i]) > 0) i++;
    if (taken.has(ids[i])) continue;
    taken.add(ids[i]);
    total -= weights[i];
    weights[i] = 0;
    addNation(ids[i]);
  }
  grow();

  // Land that growth could not reach (islands): big islands found their own nation,
  // small ones join the nearest one.
  const unreached = ids.filter((id) => !owner.has(id)).sort((a, b) => regions[b].area - regions[a].area);
  for (const start of unreached) {
    if (owner.has(start)) continue;
    const comp = component(start, engine, owner);
    const area = comp.reduce((s, id) => s + regions[id].area, 0);
    if (area > 120_000 || owner.size === 0) {
      addNation(start);
      grow();
    } else {
      const { cx: x, cy: y } = regions[start];
      let best = -1;
      let bestD = Infinity;
      for (const [rid, n] of owner) {
        const d = (regions[rid].cx - x) ** 2 + (regions[rid].cy - y) ** 2;
        if (d < bestD) [bestD, best] = [d, n];
      }
      for (const id of comp) owner.set(id, best);
    }
  }

  // Nations, coloured so that neighbours differ.
  const used = new Set<string>();
  const cids = strength.map(() => {
    let name = countryName(rand);
    for (let i = 0; used.has(name) && i < 20; i++) name = countryName(rand);
    used.add(name);
    return name;
  });
  const adj = strength.map(() => new Set<number>());
  for (const [rid, n] of owner)
    for (const nb of engine.neighbors(rid)) {
      const m = owner.get(nb);
      if (m != null && m !== n) adj[n].add(m);
    }
  const palette = earth.doc.settings.palette;
  const colors: string[] = [];
  const order = strength.map((_, i) => i).sort((a, b) => adj[b].size - adj[a].size);
  for (const n of order) {
    const near = new Set([...adj[n]].map((m) => colors[m]).filter(Boolean));
    const free = palette.filter((c) => !near.has(c));
    const pool = free.length ? free : palette;
    colors[n] = pool[Math.floor(rand() * pool.length)];
  }

  const countries: Record<string, Country> = {};
  const codeOf: string[] = [];
  cids.forEach((name, n) => {
    const base = name.replace(/^.* of /, '').normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase();
    let code = base.slice(0, 3).padEnd(3, 'X');
    for (let i = 0; countries[code]; i++) code = base.slice(0, 2) + String.fromCharCode(65 + (i % 26)) + (i >= 26 ? i : '');
    codeOf[n] = code;
    countries[code] = { cid: code, name, color: colors[n], stats: {}, fields: {} };
  });

  const newRegions: Record<number, Region> = {};
  for (const id of ids) newRegions[id] = { ...regions[id], cid: codeOf[owner.get(id)!] };

  // Capital = the most populous city inside each nation.
  const boxes = ids.map((id) => [id, bbox(earth.geoms[id])] as const);
  const cities = Object.fromEntries(Object.values(earth.doc.cities).map((c) => [c.id, { ...c, capital: false }]));
  const best: Record<string, { id: number; pop: number }> = {};
  for (const c of Object.values(cities)) {
    const hit = boxes.find(([id, b]) => c.lng >= b[0] && c.lng <= b[2] && c.lat >= b[1] && c.lat <= b[3] && pointInGeom([c.lng, c.lat], earth.geoms[id]));
    if (!hit) continue;
    const cid = newRegions[hit[0]].cid;
    if (!best[cid] || (c.pop ?? 0) > best[cid].pop) best[cid] = { id: c.id, pop: c.pop ?? 0 };
  }
  for (const [cid, b] of Object.entries(best)) {
    countries[cid].capital = b.id;
    cities[b.id].capital = true;
  }

  const now = Date.now();
  return {
    ...earth,
    doc: {
      ...earth.doc,
      meta: { ...earth.doc.meta, id: uid(), title: 'Fantasy Earth', created: now, modified: now },
      countries,
      regions: newRegions,
      cities,
      alliances: [],
    },
    flags: {},
  };
}

function component(start: number, engine: GeoEngine, owner: Map<number, number>): number[] {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    for (const nb of engine.neighbors(id)) {
      if (seen.has(nb) || owner.has(nb)) continue;
      seen.add(nb);
      stack.push(nb);
    }
  }
  return [...seen];
}

/** Binary min-heap of [cost, region, nation]. */
class MinHeap {
  private a: [number, number, number][] = [];
  push(cost: number, rid: number, n: number) {
    const a = this.a;
    a.push([cost, rid, n]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number, number] | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
