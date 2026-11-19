import { describe, expect, it } from 'vitest';
import type { FeatureCollection, LineString, Polygon } from 'geojson';
import type { WorldBundle } from '../src/types';
import { historicalEarth, ERAS } from '../src/io/history';
import { currentField, windField } from '../src/map/flow';
import { seaRamps } from '../src/map/style';

const sq = (x: number, y: number, s = 1): Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });

/** Four unclaimed unit squares in a row, with a city in each. */
function blank(): WorldBundle {
  const geoms: Record<number, Polygon> = {};
  const regions: WorldBundle['doc']['regions'] = {};
  const cities: WorldBundle['doc']['cities'] = {};
  for (let i = 0; i < 4; i++) {
    geoms[i] = sq(i, 0);
    regions[i] = { id: i, name: `R${i}`, cid: '', area: 12300, cx: i + 0.5, cy: 0.5 };
    cities[i] = { id: i, name: `C${i}`, lng: i + 0.5, lat: 0.5, capital: false, pop: 1000 * (i + 1) };
  }
  return {
    doc: {
      meta: { id: 'x', title: 'Blank', created: 0, modified: 0, source: 'blank' },
      settings: { stats: [{ key: 'Population', scale: true }], fields: [], palette: ['#aaaaaa', '#bbbbbb', '#cccccc'] },
      countries: {},
      regions,
      cities,
      water: [],
      alliances: [],
      view: { center: [0, 0], zoom: 1 },
    },
    geoms,
    flags: {},
  };
}

const polity = (name: string, x0: number, x1: number, subject?: string) => ({
  type: 'Feature' as const,
  properties: { NAME: name, SUBJECTO: subject ?? name },
  geometry: { type: 'Polygon' as const, coordinates: [[[x0, -1], [x1, -1], [x1, 2], [x0, 2], [x0, -1]]] },
});

describe('historical Earth', () => {
  const fc: FeatureCollection = {
    type: 'FeatureCollection',
    features: [polity('Belgium', -0.1, 1.9), polity('Belgian Congo', 1.9, 3.1, 'Belgium')],
  };

  it('deals regions to the state their label point lies in, the rest unclaimed', () => {
    const b = historicalEarth(blank(), fc, ERAS[0]);
    const owners = [0, 1, 2, 3].map((i) => b.doc.countries[b.doc.regions[i].cid]?.name ?? '');
    expect(owners).toEqual(['Belgium', 'Belgium', 'Belgian Congo', '']);
  });

  it('keeps a modern code only for a state of the same name, and makes colonies vassals', () => {
    const modern = { byName: new Map([['belgium', 'BEL']]), iso: new Set(['BEL', 'BES']) };
    const b = historicalEarth(blank(), fc, ERAS[0], modern);
    const congo = Object.values(b.doc.countries).find((c) => c.name === 'Belgian Congo')!;
    expect(b.doc.countries.BEL?.name).toBe('Belgium');
    // Never another country's ISO code: Belgian Congo must not fly the flag of Belgium.
    expect(modern.iso.has(congo.cid)).toBe(false);
    expect(congo.overlord).toBe('BEL');
  });

  it('gives each state its largest city as capital, and neighbours different colours', () => {
    const b = historicalEarth(blank(), fc, ERAS[0]);
    const bel = Object.values(b.doc.countries).find((c) => c.name === 'Belgium')!;
    const congo = Object.values(b.doc.countries).find((c) => c.name === 'Belgian Congo')!;
    expect(b.doc.cities[bel.capital!].name).toBe('C1');
    expect(bel.color).not.toBe(congo.color);
  });
});

describe('winds and currents', () => {
  it('samples a wind grid bilinearly and wraps around the antimeridian', () => {
    const f = windField({ nx: 4, ny: 3, lo1: -180, la1: 90, dx: 90, dy: 90, u: [0, 10, 0, 0, 0, 10, 0, 0, 0, 10, 0, 0], v: Array(12).fill(0) });
    expect(f.at(-90, 0)![0]).toBeCloseTo(10);
    expect(f.at(-135, 0)![0]).toBeCloseTo(5);
    expect(f.at(170, 0)![0]).toBeCloseTo(0);
  });

  it('turns a current line into a field flowing along it, tagged warm or cold', () => {
    const fc: FeatureCollection<LineString, { temp?: string; strength?: number }> = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { temp: 'warm', strength: 2 }, geometry: { type: 'LineString', coordinates: [[-40, 30], [-20, 30]] } }],
    };
    const f = currentField(fc);
    const [u, v, tag] = f.at(-30, 30)!;
    expect(u).toBeGreaterThan(0.3);
    expect(Math.abs(v)).toBeLessThan(0.05);
    expect(tag).toBe(1);
    expect(Math.hypot(...f.at(-30, 40)!.slice(0, 2))).toBe(0);
  });
});

describe('sea level ramps', () => {
  it('shows land only above the lowered sea and water only where the raised sea spills', () => {
    const { emerged, flooded } = seaRamps(-50, '#111111', '#222222');
    const stops = (e: unknown) => (e as unknown[]).slice(3) as (number | string)[];
    const em = stops(emerged);
    expect(em[em.indexOf(-50) + 1]).toBe('#111111');
    const fl = stops(seaRamps(20, '#111111', '#222222').flooded);
    expect(fl[fl.indexOf(20) + 1]).toBe('#222222');
    expect(fl[fl.indexOf(-100) + 1]).toBe('rgba(0,0,0,0)');
    expect(flooded).toBeTruthy();
  });
});

describe('sea level: coastal fringe', () => {
  it('drops one-cell strips and keeps floods two cells across', async () => {
    const { open } = await import('../src/world/sealevel');
    const w = 8;
    const h = 6;
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) m[y * w + 1] = 1; // a strip one cell wide
    for (let y = 2; y < 5; y++) for (let x = 4; x < 7; x++) m[y * w + x] = 1; // a 3×3 flood
    open(m, w, h);
    expect([...Array(h).keys()].some((y) => m[y * w + 1])).toBe(false);
    expect(m[3 * w + 5]).toBe(1);
    expect(m[2 * w + 4]).toBe(1);
  });
});
