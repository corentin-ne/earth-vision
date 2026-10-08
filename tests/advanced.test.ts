import { describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import type { WorldBundle } from '../src/types';
import { useWorld, loadWorld, undo, countryAggregates } from '../src/world/store';
import { healBorders, autoColor, recalcPopulation, removeEmptyCountries, assignCapitals } from '../src/world/advanced';
import { estimatePopulation } from '../src/world/population';
import { geomArea } from '../src/geo/engine';

const sq = (x: number, y: number, s = 1): Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });

/**
 * 5×5 grid, all AAA except: BBB owns the right column plus a stray square at (1,1),
 * and (2,3) is an unclaimed hole.
 */
function world(): WorldBundle {
  const geoms: WorldBundle['geoms'] = {};
  const regions: WorldBundle['doc']['regions'] = {};
  for (let i = 0; i < 25; i++) {
    const x = i % 5;
    const y = Math.floor(i / 5);
    geoms[i] = sq(x, y);
    const cid = x === 4 || (x === 1 && y === 1) ? 'BBB' : x === 2 && y === 3 ? '' : 'AAA';
    regions[i] = { id: i, name: `R${i}`, cid, area: geomArea(geoms[i]), cx: x + 0.5, cy: y + 0.5, vals: { Population: 100 } };
  }
  return {
    doc: {
      meta: { id: 'a', title: 'A', created: 0, modified: 0, source: 'blank' },
      settings: { stats: [{ key: 'Population', scale: true }], fields: [], palette: ['#FF0000', '#00FF00', '#0000FF'] },
      countries: {
        AAA: { cid: 'AAA', name: 'Aland', color: '#FF0000', stats: {}, fields: {} },
        BBB: { cid: 'BBB', name: 'Bland', color: '#FF0000', stats: {}, fields: {} },
        CCC: { cid: 'CCC', name: 'Gone', color: '#0000FF', stats: {}, fields: {} },
      },
      regions,
      cities: { 0: { id: 0, name: 'Big', lng: 0.5, lat: 0.5, capital: false, pop: 10 }, 1: { id: 1, name: 'Bigger', lng: 3.5, lat: 0.5, capital: false, pop: 20 } },
      water: [],
      alliances: [],
    },
    geoms,
    flags: {},
  };
}

const doc = () => useWorld.getState().doc!;

describe('advanced tools', () => {
  it('heals stray pieces and holes but keeps a country’s heartland', () => {
    loadWorld(world());
    const moved = healBorders(1e9);
    expect(moved).toBe(2);
    expect(doc().regions[6].cid).toBe('AAA'); // the stray BBB square
    expect(doc().regions[17].cid).toBe('AAA'); // the unclaimed hole
    expect(doc().regions[4].cid).toBe('BBB'); // the BBB column stays
    undo();
    expect(doc().regions[6].cid).toBe('BBB');
  });

  it('respects the size limit', () => {
    loadWorld(world());
    expect(healBorders(1)).toBe(0);
  });

  it('recolours neighbours differently', () => {
    loadWorld(world());
    autoColor();
    expect(doc().countries.AAA.color).not.toBe(doc().countries.BBB.color);
  });

  it('spreads each country’s total by area', async () => {
    loadWorld(world());
    const before = countryAggregates(doc()).AAA.vals.Population;
    await recalcPopulation('even');
    const after = countryAggregates(doc()).AAA.vals.Population;
    expect(after).toBeCloseTo(before, 6);
  });

  it('removes empty countries and picks capitals', () => {
    loadWorld(world());
    expect(removeEmptyCountries()).toBe(1);
    expect(doc().countries.CCC).toBeUndefined();
    expect(assignCapitals()).toBe(1);
    expect(doc().countries.AAA.capital).toBe(1); // the bigger city inside AAA
  });
});

describe('population model', () => {
  it('uses the density under each region and adds the cities inside it', () => {
    const w = world();
    const regions = Object.values(w.doc.regions);
    const model = {
      areas: [{ box: [0, 0, 5, 5] as [number, number, number, number], geom: sq(0, 0, 5), density: 2, cx: 2.5, cy: 2.5 }],
      cities: [{ lng: 0.5, lat: 0.5, pop: 1000 }],
    };
    const est = estimatePopulation(regions, w.geoms, model);
    expect(est[1]).toBe(Math.round(2 * regions[1].area));
    expect(est[0]).toBe(Math.round(2 * regions[0].area) + 1000);
  });
});
