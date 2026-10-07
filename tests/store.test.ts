import { beforeEach, describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import type { WorldBundle } from '../src/types';
import {
  useWorld,
  loadWorld,
  transferRegions,
  undo,
  redo,
  endGroup,
  splitAlong,
  mergeRegions,
  createCountry,
  annexCountry,
  setStat,
  countryAggregates,
} from '../src/world/store';

const sq = (x: number, y: number, s = 1): Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });

function world(): WorldBundle {
  const geoms = { 0: sq(0, 1), 1: sq(1, 1), 2: sq(0, 0), 3: sq(1, 0) };
  const regions = Object.fromEntries(
    Object.keys(geoms).map((k) => {
      const id = Number(k);
      return [id, { id, name: `R${id}`, cid: id < 2 ? 'AAA' : 'BBB', area: 12300, cx: 0, cy: 0, vals: { Population: 100 } }];
    }),
  );
  return {
    doc: {
      meta: { id: 't', title: 'T', created: 0, modified: 0, source: 'blank' },
      settings: { stats: [{ key: 'Population', scale: true }], fields: [], palette: ['#ff0000', '#00ff00', '#0000ff'] },
      countries: {
        AAA: { cid: 'AAA', name: 'Aland', color: '#ff0000', stats: {}, fields: {} },
        BBB: { cid: 'BBB', name: 'Bland', color: '#00ff00', stats: {}, fields: {} },
      },
      regions,
      cities: {},
      water: [],
      alliances: [],
    },
    geoms,
    flags: {},
  };
}

const doc = () => useWorld.getState().doc!;

describe('world store', () => {
  beforeEach(() => loadWorld(world()));

  it('transfers regions and carries population', () => {
    transferRegions([2], 'AAA');
    expect(doc().regions[2].cid).toBe('AAA');
    const agg = countryAggregates(doc());
    expect(agg.AAA.vals.Population).toBe(300);
    expect(agg.BBB.vals.Population).toBe(100);
    expect(doc().countries.AAA.label).toBeDefined();
  });

  it('undoes and redoes', () => {
    transferRegions([2], 'AAA');
    undo();
    expect(doc().regions[2].cid).toBe('BBB');
    redo();
    expect(doc().regions[2].cid).toBe('AAA');
  });

  it('groups a paint stroke into one undo step', () => {
    transferRegions([2], 'AAA', { group: 'stroke' });
    transferRegions([3], 'AAA', { group: 'stroke' });
    endGroup();
    transferRegions([0], 'BBB');
    expect(useWorld.getState().past).toHaveLength(2);
    undo();
    undo();
    expect(doc().regions[2].cid).toBe('BBB');
    expect(doc().regions[3].cid).toBe('BBB');
    expect(doc().regions[0].cid).toBe('AAA');
  });

  it('splits a region and undo restores the geometry', () => {
    const before = useWorld.getState().geoms;
    const n = splitAlong(
      [
        [0.5, 0.5],
        [0.5, 2.5],
      ],
      [0],
    );
    expect(n).toBe(1);
    expect(Object.keys(doc().regions)).toHaveLength(5);
    expect(doc().regions[4].cid).toBe('AAA');
    const pop = (doc().regions[0].vals!.Population ?? 0) + (doc().regions[4].vals!.Population ?? 0);
    expect(pop).toBeCloseTo(100);
    undo();
    expect(Object.keys(doc().regions)).toHaveLength(4);
    expect(useWorld.getState().geoms[0]).toEqual(before[0]);
  });

  it('merges regions', () => {
    const id = mergeRegions([0, 1]);
    expect(id).not.toBeNull();
    expect(Object.keys(doc().regions)).toHaveLength(3);
    expect(doc().regions[id!].vals!.Population).toBe(200);
  });

  it('creates and annexes countries', () => {
    const cid = createCountry('Newland', [3]);
    expect(doc().regions[3].cid).toBe(cid);
    annexCountry(cid, 'AAA');
    expect(doc().countries[cid]).toBeUndefined();
    expect(doc().regions[3].cid).toBe('AAA');
  });

  it('rescales a scaling stat over the regions', () => {
    setStat('AAA', 'Population', 1000);
    expect(countryAggregates(doc()).AAA.vals.Population).toBeCloseTo(1000);
    expect(doc().regions[0].vals!.Population).toBeCloseTo(500);
  });
});
