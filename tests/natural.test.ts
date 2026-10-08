import { beforeEach, describe, expect, it } from 'vitest';
import type { FeatureCollection, Polygon } from 'geojson';
import type { LngLat, WorldBundle } from '../src/types';
import { cutGeom } from '../src/geo/split';
import { geomArea } from '../src/geo/engine';
import { Barriers, setBarriers } from '../src/geo/barriers';
import {
  useWorld,
  loadWorld,
  undo,
  redo,
  endGroup,
  engine,
  transferRegions,
  createAlliance,
  setMember,
  deleteAlliance,
  deleteCountry,
  updateAlliance,
} from '../src/world/store';
import { blocked, claimUpToNature, cutAlongNature, reachable } from '../src/world/natural';

const sq = (x: number, y: number, s = 1): Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });

// A river running north–south at x = 1.5, wiggling, through the middle column of a 3×1 strip.
const RIVER: LngLat[] = [
  [1.5, -0.5],
  [1.45, 0.3],
  [1.55, 0.7],
  [1.5, 1.5],
];
const fc = (lines: LngLat[][], props: Record<string, unknown>): FeatureCollection => ({
  type: 'FeatureCollection',
  features: lines.map((coordinates) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates } })),
});

function world(): WorldBundle {
  // Three regions side by side: A A B (B owns the right one, A the two left ones).
  const geoms = { 0: sq(0, 0), 1: sq(1, 0), 2: sq(2, 0) };
  const regions = Object.fromEntries(
    Object.keys(geoms).map((k) => {
      const id = Number(k);
      return [id, { id, name: `R${id}`, cid: id < 2 ? 'AAA' : 'BBB', area: 12000, cx: id + 0.5, cy: 0.5, vals: { Population: 300 } }];
    }),
  );
  return {
    doc: {
      meta: { id: 't', title: 'T', created: 0, modified: 0, source: 'blank' },
      settings: { stats: [{ key: 'Population', scale: true }], fields: [], palette: ['#ff0000'] },
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

describe('cutGeom', () => {
  it('cuts a square exactly along a crossing line', () => {
    const pieces = cutGeom(sq(1, 0), [RIVER])!;
    expect(pieces).toHaveLength(2);
    const total = pieces.reduce((t, g) => t + geomArea(g), 0);
    expect(total).toBeCloseTo(geomArea(sq(1, 0)), 3);
    // The river's own vertices are on the new border.
    const coords = JSON.stringify(pieces.map((p) => p.coordinates));
    expect(coords).toContain('[1.45,0.3]');
    expect(coords).toContain('[1.55,0.7]');
  });

  it('leaves a region a line only grazes', () => {
    expect(cutGeom(sq(0, 0), [RIVER])).toBeNull();
    // Running along the border, in and out by a hair: no sliver pieces.
    expect(cutGeom(sq(0, 0), [[[1.001, -1], [0.999, 0.5], [1.001, 2]]])).toBeNull();
  });

  it('cuts once per crossing', () => {
    const zig: LngLat[] = [[0.3, -0.5], [0.3, 1.5], [0.7, 1.5], [0.7, -0.5]];
    expect(cutGeom(sq(0, 0), [zig])).toHaveLength(3);
  });
});

describe('natural borders', () => {
  beforeEach(() => {
    loadWorld(world());
    setBarriers(new Barriers(fc([RIVER], { scalerank: 4, name: 'Test river' }), fc([], {})));
    useWorld.setState({ natural: { rivers: 'major', crests: false } });
  });

  it('knows which straight moves cross the river', () => {
    expect(blocked([1.2, 0.5], [1.8, 0.5])).toBe(true);
    expect(blocked([1.2, 0.5], [1.3, 0.9])).toBe(false);
    useWorld.setState({ natural: { rivers: 'off', crests: true } });
    expect(blocked([1.2, 0.5], [1.8, 0.5])).toBe(false);
  });

  it('cuts crossed regions in one undo step and keeps borders shared', () => {
    const before = Object.keys(doc().regions).length;
    const after = cutAlongNature([0, 1, 2]);
    expect(after).toHaveLength(4);
    expect(Object.keys(doc().regions)).toHaveLength(before + 1);
    // The middle region now has a west and an east piece; population shared by area.
    const pieces = after.filter((id) => id === 1 || id >= 3).map((id) => doc().regions[id]);
    expect(pieces.map((r) => r.name).sort()).toEqual(['R1 (east)', 'R1 (west)']);
    expect(pieces.reduce((t, r) => t + r.vals!.Population, 0)).toBeCloseTo(300, 6);
    // The two pieces border each other and both neighbours (no gap along the cut).
    const [w, e] = pieces[0].name.endsWith('(west)') ? pieces : [pieces[1], pieces[0]];
    expect(engine.neighbors(w.id).sort()).toEqual([0, e.id].sort());
    expect(engine.neighbors(e.id).sort()).toEqual([2, w.id].sort());
    undo();
    expect(Object.keys(doc().regions)).toHaveLength(before);
    redo();
    expect(Object.keys(doc().regions)).toHaveLength(before + 1);
  });

  it('a brush dab takes only what is on its side of the river', () => {
    const ids = cutAlongNature([1]);
    const take = reachable([1.2, 0.5], [[1.8, 0.5], [1.1, 0.2]], ids);
    expect(take.map((id) => doc().regions[id].name)).toEqual(['R1 (west)']);
  });

  it('takes a country up to the river', () => {
    // Bland (BBB) claims Aland from the west: everything west of the river, nothing beyond.
    loadWorld({ ...world(), doc: { ...world().doc, regions: { ...world().doc.regions, 2: { ...world().doc.regions[2], cid: 'AAA' } } } });
    useWorld.setState({ natural: { rivers: 'major', crests: false } });
    const n = claimUpToNature([0.5, 0.5], 'BBB', { group: 'g' });
    endGroup();
    expect(n).toBe(2);
    const owners = Object.values(doc().regions).map((r) => `${r.name}:${r.cid}`).sort();
    expect(owners).toEqual(['R0:BBB', 'R1 (east):AAA', 'R1 (west):BBB', 'R2:AAA']);
    undo();
    expect(Object.values(doc().regions).every((r) => r.cid === 'AAA')).toBe(true);
    expect(Object.keys(doc().regions)).toHaveLength(3);
  });
});

describe('alliances', () => {
  beforeEach(() => loadWorld(world()));

  it('are founded, joined, left and disbanded with undo', () => {
    const id = createAlliance('Pact', ['AAA']);
    setMember(id, 'BBB', true);
    expect(doc().alliances[0].members).toEqual(['AAA', 'BBB']);
    updateAlliance(id, { color: '#123456' });
    setMember(id, 'AAA', false);
    expect(doc().alliances[0]).toMatchObject({ name: 'Pact', color: '#123456', members: ['BBB'] });
    undo();
    expect(doc().alliances[0].members).toEqual(['AAA', 'BBB']);
    deleteAlliance(id);
    expect(doc().alliances).toHaveLength(0);
    undo();
    expect(doc().alliances[0].name).toBe('Pact');
  });

  it('lose a member that is dissolved, and get it back on undo', () => {
    const id = createAlliance('Pact', ['AAA', 'BBB']);
    deleteCountry('AAA');
    expect(doc().alliances.find((a) => a.id === id)!.members).toEqual(['BBB']);
    undo();
    expect(doc().alliances.find((a) => a.id === id)!.members).toEqual(['AAA', 'BBB']);
  });
});

describe('paint strokes', () => {
  beforeEach(() => loadWorld(world()));

  it('place country labels once, at the end of the stroke, in the same undo step', () => {
    const labelB = doc().countries.BBB.label;
    transferRegions([1], 'BBB', { group: 'stroke', deferLabels: true });
    expect(doc().countries.BBB.label).toEqual(labelB);
    transferRegions([0], 'BBB', { group: 'stroke', deferLabels: true });
    endGroup();
    expect(doc().countries.BBB.label).not.toEqual(labelB);
    expect(useWorld.getState().past).toHaveLength(1);
    undo();
    expect(doc().countries.BBB.label).toEqual(labelB);
    expect(doc().regions[0].cid).toBe('AAA');
  });
});
