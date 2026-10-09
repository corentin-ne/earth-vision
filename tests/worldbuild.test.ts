import { beforeEach, describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import type { WorldBundle } from '../src/types';
import { useWorld, loadWorld, transferRegions, annexCountry, deleteCountry, undo, engine } from '../src/world/store';
import {
  setOccupation,
  createState,
  assignState,
  deleteState,
  setOverlord,
  realmOf,
  addLand,
  deleteRegions,
  addMark,
  findReplace,
  applyFindReplace,
  moveLabel,
} from '../src/world/edits';
import { computeThematic } from '../src/world/thematic';
import { exportAmap, importAmap } from '../src/io/amap';
import { geomIssues } from '../src/geo/repair';
import { countryCurve } from '../src/map/curves';

const sq = (x: number, y: number, s = 1): Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });

/** Three countries over six unit squares: AAA | BBB | CCC, two rows. */
function world(): WorldBundle {
  const geoms: Record<number, Polygon> = {};
  const regions: WorldBundle['doc']['regions'] = {};
  const owners = ['AAA', 'BBB', 'CCC'];
  for (let i = 0; i < 6; i++) {
    const x = i % 3;
    const y = Math.floor(i / 3);
    geoms[i] = sq(x, y);
    regions[i] = { id: i, name: `R${i}`, cid: owners[x], area: 12300, cx: x + 0.5, cy: y + 0.5, vals: { Population: 100 * (x + 1) } };
  }
  const country = (cid: string, name: string, color: string) => ({ cid, name, color, stats: { GDP: 1000 }, fields: { Language: cid === 'CCC' ? 'Bland' : 'Common' } });
  return {
    doc: {
      meta: { id: 't', title: 'T', created: 0, modified: 0, source: 'blank' },
      settings: { stats: [{ key: 'Population', scale: true }, { key: 'GDP', scale: false }], fields: ['Language'], palette: ['#ff0000', '#00ff00', '#0000ff'] },
      countries: { AAA: country('AAA', 'Aland', '#ff0000'), BBB: country('BBB', 'Bland', '#00ff00'), CCC: country('CCC', 'Cland', '#0000ff') },
      regions,
      cities: { 0: { id: 0, name: 'Acity', lng: 0.5, lat: 0.5, capital: true } },
      water: [],
      alliances: [],
    },
    geoms,
    flags: {},
  };
}

const doc = () => useWorld.getState().doc!;

describe('occupation', () => {
  beforeEach(() => loadWorld(world()));

  it('marks regions as held by another country, and ends when it takes them', () => {
    expect(setOccupation([1, 4], 'AAA')).toBe(2);
    expect(doc().regions[1].occ).toBe('AAA');
    expect(doc().regions[1].cid).toBe('BBB');
    // Occupying your own land does nothing.
    expect(setOccupation([0], 'AAA')).toBe(0);
    transferRegions([1], 'AAA');
    expect(doc().regions[1].occ).toBeUndefined();
    expect(doc().regions[4].occ).toBe('AAA');
    undo();
    expect(doc().regions[1].occ).toBe('AAA');
  });

  it('passes to the annexing country, and lapses when the occupier is dissolved', () => {
    setOccupation([2], 'BBB');
    annexCountry('BBB', 'AAA');
    expect(doc().regions[2].occ).toBe('AAA');
    deleteCountry('AAA');
    expect(doc().regions[2].occ).toBeUndefined();
  });
});

describe('states', () => {
  beforeEach(() => loadWorld(world()));

  it('groups regions of a country, and loses them when they change hands', () => {
    const k = createState('AAA', 'North', [0, 3, 1])!;
    expect(doc().countries.AAA.states?.[k].name).toBe('North');
    // Region 1 belongs to BBB: not put in AAA's state.
    expect(doc().regions[1].state).toBeUndefined();
    expect(doc().regions[0].state).toBe(k);
    transferRegions([3], 'BBB');
    expect(doc().regions[3].state).toBeUndefined();
    expect(assignState([1], k)).toBe(0);
    deleteState('AAA', k);
    expect(doc().regions[0].state).toBeUndefined();
    expect(doc().countries.AAA.states?.[k]).toBeUndefined();
  });
});

describe('vassals', () => {
  beforeEach(() => loadWorld(world()));

  it('chains overlords and refuses loops', () => {
    setOverlord('CCC', 'BBB');
    setOverlord('BBB', 'AAA');
    expect(realmOf('CCC')).toBe('AAA');
    setOverlord('AAA', 'CCC');
    expect(doc().countries.AAA.overlord).toBeUndefined();
    const t = computeThematic(doc(), { kind: 'realm' });
    expect(t.colors.AAA).toBe('#ff0000');
    expect(t.colors.CCC).not.toBe('#0000ff');
  });

  it('follow their overlord when it is annexed', () => {
    setOverlord('CCC', 'BBB');
    annexCountry('BBB', 'AAA');
    expect(doc().countries.CCC.overlord).toBe('AAA');
  });
});

describe('new land', () => {
  beforeEach(() => loadWorld(world()));

  it('raises an island at sea', () => {
    const id = addLand([[5, 0], [6, 0], [6, 1], [5, 1]], 'CCC')!;
    expect(doc().regions[id].cid).toBe('CCC');
    expect(doc().regions[id].area).toBeGreaterThan(10000);
    expect(geomIssues(useWorld.getState().geoms[id])).toEqual([]);
  });

  it('only takes the sea part of an outline, sharing the coast with the land it touches', () => {
    // Overlaps column x ∈ [2, 3] (CCC) and reaches out to x = 4.
    const id = addLand([[2.5, 0.2], [4, 0.2], [4, 1.8], [2.5, 1.8]], '')!;
    const g = useWorld.getState().geoms[id];
    expect(geomIssues(g)).toEqual([]);
    const xs = (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()).flat().map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(3, 6);
    const nb = engine.neighbors(id);
    expect(nb).toContain(2);
    expect(nb).toContain(5);
  });

  it('refuses an outline that is all land', () => {
    expect(addLand([[0.2, 0.2], [0.8, 0.2], [0.8, 0.8]], 'AAA')).toBeNull();
  });

  it('sinks regions, as one undo step', () => {
    deleteRegions([0, 1]);
    expect(doc().regions[0]).toBeUndefined();
    expect(useWorld.getState().geoms[1]).toBeUndefined();
    undo();
    expect(doc().regions[0]).toBeDefined();
    expect(useWorld.getState().geoms[1]).toBeDefined();
  });
});

describe('find & replace', () => {
  beforeEach(() => loadWorld(world()));

  it('previews and replaces across names, fields and notes in one undo step', () => {
    const scope = { countries: true, regions: true, cities: true, fields: true, notes: true, marks: true };
    const opts = { matchCase: false, wholeWord: false };
    expect(findReplace('land', 'realm', scope, opts).hits.length).toBe(4); // three countries + CCC's language
    expect(findReplace('land', 'realm', scope, { matchCase: false, wholeWord: true }).hits.length).toBe(0);
    expect(applyFindReplace('land', 'realm', scope, opts)).toBe(4);
    expect(doc().countries.AAA.name).toBe('Arealm');
    expect(doc().countries.CCC.fields.Language).toBe('Brealm');
    undo();
    expect(doc().countries.AAA.name).toBe('Aland');
  });
});

describe('labels placed by hand', () => {
  beforeEach(() => loadWorld(world()));

  it('stay put when the borders change', () => {
    moveLabel('AAA', [0.3, 0.7]);
    transferRegions([1], 'AAA');
    expect(doc().countries.AAA.label).toEqual([0.3, 0.7]);
  });
});

describe('.map round trip', () => {
  beforeEach(() => loadWorld(world()));

  it('keeps lore, states, vassals, occupations, marks and data layers', async () => {
    const k = createState('AAA', 'North', [0, 3])!;
    setOverlord('CCC', 'BBB');
    setOccupation([4], 'AAA');
    moveLabel('BBB', [1.4, 1.6]);
    addMark({ id: 'm1', type: 'line', kind: 'road', name: 'Old Road', color: '#8a5a2b', coords: [[0, 0], [3, 2]] });
    useWorld.setState({ doc: { ...doc(), overlays: ['reefs'] } });
    const s = useWorld.getState();
    const regions = { ...s.doc!.regions, 2: { ...s.doc!.regions[2], notes: 'See [[Aland]]' } };
    const cities = { 0: { ...s.doc!.cities[0], notes: 'Founded long ago' } };
    const bytes = await exportAmap({ doc: { ...s.doc!, regions, cities }, geoms: s.geoms, flags: {} });
    const back = importAmap(bytes, 'T.map').doc;
    expect(back.countries.AAA.states?.[k].name).toBe('North');
    expect(back.regions[0].state).toBe(k);
    expect(back.countries.CCC.overlord).toBe('BBB');
    expect(back.regions[4].occ).toBe('AAA');
    expect(back.countries.BBB.labelFixed).toBe(true);
    expect(back.countries.BBB.label).toEqual([1.4, 1.6]);
    expect(back.regions[2].notes).toBe('See [[Aland]]');
    expect(back.cities[0].notes).toBe('Founded long ago');
    expect(back.marks?.m1.type).toBe('line');
    expect(back.overlays).toEqual(['reefs']);
  });
});

describe('thematic maps', () => {
  beforeEach(() => loadWorld(world()));

  it('classes figures and categorises fields', () => {
    const pop = computeThematic(doc(), { kind: 'stat', key: 'Population', per: 'total' });
    expect(new Set(Object.values(pop.colors)).size).toBe(3);
    const lang = computeThematic(doc(), { kind: 'field', key: 'Language' });
    expect(lang.colors.AAA).toBe(lang.colors.BBB);
    expect(lang.colors.CCC).not.toBe(lang.colors.AAA);
    expect(lang.legend.map((l) => l.label)).toContain('Common');
  });
});

describe('curved names', () => {
  it('follow a long country and skip a round one', () => {
    const long = countryCurve({ type: 'MultiPolygon', coordinates: [[[[0, 0], [20, 2], [20, 6], [0, 4], [0, 0]]]] });
    expect(long).not.toBeNull();
    const c = long!.coordinates;
    expect(c[0][0]).toBeLessThan(c[c.length - 1][0]);
    expect(countryCurve({ type: 'MultiPolygon', coordinates: [[[[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]]] })).toBeNull();
  });
});
