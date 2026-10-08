import { describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import { strFromU8, strToU8, zipSync } from 'fflate';
import type { WorldBundle } from '../src/types';
import { exportAmap, importAmap, unzipAmap } from '../src/io/amap';
import { fantasyEarth } from '../src/world/generate';
import { countryName, seeded, randomColor } from '../src/world/names';
import { fmtAgo } from '../src/util';

const sq = (x: number, y: number, s = 1): Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });

/** An n×n grid of square regions; the left half belongs to AAA, the right half to BBB. */
function grid(n = 6): WorldBundle {
  const geoms: WorldBundle['geoms'] = {};
  const regions: WorldBundle['doc']['regions'] = {};
  for (let i = 0; i < n * n; i++) {
    const x = i % n;
    const y = Math.floor(i / n);
    geoms[i] = sq(x, y);
    regions[i] = { id: i, name: `R${i}`, cid: x < n / 2 ? 'AAA' : 'BBB', area: 12300, cx: x + 0.5, cy: y + 0.5, vals: { Population: 10 + i } };
  }
  return {
    doc: {
      meta: { id: 't', title: 'Grid', created: 1234, modified: 0, source: 'blank' },
      settings: { stats: [{ key: 'Population', scale: true }, { key: 'GDP', scale: false }], fields: ['Leader', 'Motto'], palette: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'] },
      countries: {
        AAA: { cid: 'AAA', name: 'Aland', color: '#FF0000', stats: { GDP: 5 }, fields: { Leader: 'Ada' }, notes: 'Founded on a Tuesday.' },
        BBB: { cid: 'BBB', name: 'Bland', color: '#00FF00', stats: { GDP: 7 }, fields: {} },
      },
      regions,
      cities: { 0: { id: 0, name: 'Acity', lng: 0.5, lat: 0.5, capital: true, pop: 4242 } },
      water: [],
      alliances: [],
      view: { center: [3, 3], zoom: 4 },
    },
    geoms,
    flags: {},
  };
}

describe('.map export', () => {
  it('is an A+ file that keeps notes, per-region populations and city sizes', async () => {
    const b = grid();
    b.doc.countries.AAA.capital = 0;
    const out = await exportAmap(b);
    expect(String.fromCharCode(...out.slice(0, 4))).toBe('A+WM');
    expect(Object.keys(unzipAmap(out))).toContain('earth_vision.json');

    const again = importAmap(out, 'grid.map');
    expect(again.doc.meta.created).toBe(1234);
    expect(again.doc.countries.AAA.notes).toBe('Founded on a Tuesday.');
    expect(again.doc.countries.AAA.fields.Leader).toBe('Ada');
    expect(again.doc.countries.BBB.stats.GDP).toBe(7);
    expect(again.doc.cities[0].pop).toBe(4242);
    expect(again.doc.view).toEqual({ center: [3, 3], zoom: 4 });
    // Exact per-region values, not an even spread by area.
    for (const r of Object.values(b.doc.regions)) expect(again.doc.regions[r.id].vals?.Population).toBe(r.vals!.Population);
    // The sidecar is not carried as an opaque extra file.
    expect(again.passthrough?.['earth_vision.json']).toBeUndefined();
  });

  it('falls back to the A+ totals when the map was edited in A+ since', async () => {
    const out = await exportAmap(grid());
    const files = unzipAmap(out);
    // Simulate A+ changing Aland's population: country_simple info[0] is Population.
    const cfc = JSON.parse(strFromU8(files['country_simple.json']));
    const aland = cfc.features.find((f: { properties: { cid: string } }) => f.properties.cid === 'AAA');
    aland.properties.info[0] = 1800;
    files['country_simple.json'] = strToU8(JSON.stringify(cfc));
    const zipped = zipSync({ 'country_simple.json': files['country_simple.json'], ...files });
    const b = importAmap(zipped, 'edited.map');
    const aRegions = Object.values(b.doc.regions).filter((r) => r.cid === 'AAA');
    for (const r of aRegions) expect(r.vals?.Population).toBeCloseTo(1800 / aRegions.length, 5);
    // Bland was not touched: its exact values survive.
    expect(b.doc.regions[3].vals?.Population).toBe(13);
  });
});

describe('Fantasy Earth', () => {
  it('deals every region to an invented nation, deterministically', () => {
    const a = fantasyEarth(grid(10), { nations: 5, seed: 42 });
    const b = fantasyEarth(grid(10), { nations: 5, seed: 42 });
    const owners = Object.values(a.doc.regions).map((r) => r.cid);
    expect(owners.every((cid) => !!a.doc.countries[cid])).toBe(true);
    expect(Object.keys(a.doc.countries).length).toBe(5);
    expect(owners).toEqual(Object.values(b.doc.regions).map((r) => r.cid));
    expect(Object.values(a.doc.countries).map((c) => c.name)).toEqual(Object.values(b.doc.countries).map((c) => c.name));
    // Population travels with the land.
    const pop = (x: WorldBundle) => Object.values(x.doc.regions).reduce((s, r) => s + (r.vals?.Population ?? 0), 0);
    expect(pop(a)).toBe(pop(grid(10)));
    // The only city becomes a capital.
    expect(Object.values(a.doc.countries).filter((c) => c.capital === 0)).toHaveLength(1);
  });

  it('keeps each nation in one piece on connected land', () => {
    const w = fantasyEarth(grid(10), { nations: 6, seed: 7 });
    const byCid: Record<string, Set<number>> = {};
    for (const r of Object.values(w.doc.regions)) (byCid[r.cid] ??= new Set()).add(r.id);
    for (const ids of Object.values(byCid)) {
      const start = [...ids][0];
      const seen = new Set([start]);
      const stack = [start];
      while (stack.length) {
        const i = stack.pop()!;
        for (const j of [i - 1, i + 1, i - 10, i + 10]) {
          if (!ids.has(j) || seen.has(j) || (Math.abs(j - i) === 1 && Math.floor(j / 10) !== Math.floor(i / 10))) continue;
          seen.add(j);
          stack.push(j);
        }
      }
      expect(seen.size).toBe(ids.size);
    }
  });
});

describe('names & formatting', () => {
  it('invents readable names and colours', () => {
    const rand = seeded(1);
    for (let i = 0; i < 50; i++) {
      expect(countryName(rand)).toMatch(/^[A-Z][A-Za-z ]+$/);
      expect(randomColor(rand)).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('formats relative times', () => {
    const now = 1_000_000_000_000;
    expect(fmtAgo(now - 5_000, now)).toBe('just now');
    expect(fmtAgo(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(fmtAgo(now - 26 * 3600_000, now)).toBe('yesterday');
  });
});

describe('flag designs', () => {
  it('are valid and reproducible from a seed', async () => {
    const { randomSpec, LAYOUTS, EMBLEMS } = await import('../src/world/flagGen');
    const a = randomSpec('#D6C7FF', seeded(9));
    const b = randomSpec('#D6C7FF', seeded(9));
    expect(a).toEqual(b);
    const rand = seeded(3);
    for (let i = 0; i < 100; i++) {
      const s = randomSpec(undefined, rand);
      expect(LAYOUTS.some((l) => l.id === s.layout)).toBe(true);
      expect(EMBLEMS.some((e) => e.id === s.emblem)).toBe(true);
      expect(new Set(s.colors).size).toBe(3);
      for (const c of [...s.colors, s.emblemColor]) expect(c).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
