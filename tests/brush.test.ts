import { beforeEach, describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import type { LngLat, WorldBundle } from '../src/types';
import { useWorld, loadWorld, undo, engine, countryAggregates } from '../src/world/store';
import { islandParts, islandsUnder, loopShape, paintLasso, paintStroke, separateLasso, strokeShape } from '../src/world/brush';
import { Barriers, setBarriers } from '../src/geo/barriers';
import type { FeatureCollection } from 'geojson';
import { Coastline, snapCoasts } from '../src/geo/coast';
import { geomIssues } from '../src/geo/repair';
import { geomArea } from '../src/geo/engine';

const sq = (x: number, y: number, s = 1): Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });

/** Two countries side by side, two unit squares each: AAA (x 0–1) | BBB (x 1–2). */
function world(): WorldBundle {
  const geoms = { 0: sq(0, 0), 1: sq(0, 1), 2: sq(1, 0), 3: sq(1, 1) };
  const regions = Object.fromEntries(
    [0, 1, 2, 3].map((id) => [id, { id, name: `R${id}`, cid: id < 2 ? 'AAA' : 'BBB', area: 12000, cx: (id < 2 ? 0 : 1) + 0.5, cy: (id % 2) + 0.5, vals: { Population: 100 } }]),
  );
  return {
    doc: {
      meta: { id: 't', title: 'T', created: 0, modified: 0, source: 'blank' },
      settings: { stats: [{ key: 'Population', scale: true }], fields: [], palette: ['#ff0000'] },
      countries: { AAA: { cid: 'AAA', name: 'Aland', color: '#ff0000', stats: {}, fields: {} }, BBB: { cid: 'BBB', name: 'Bland', color: '#00ff00', stats: {}, fields: {} } },
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
const geoms = () => useWorld.getState().geoms;

describe('lasso', () => {
  beforeEach(() => loadWorld(world()));

  it('takes whole regions lying mostly in the loop', () => {
    // Around region 2 and a corner of region 3.
    const n = paintLasso([[0.95, -0.1], [2.1, -0.1], [2.1, 1.2], [0.95, 1.2]], 'AAA', false);
    expect(n).toBe(1);
    expect(doc().regions[2].cid).toBe('AAA');
    expect(doc().regions[3].cid).toBe('BBB');
    expect(Object.keys(doc().regions).length).toBe(4);
  });

  it('cuts the regions on its edge and takes only the inside, as one undo step', () => {
    const before = countryAggregates(doc()).BBB.area;
    const n = paintLasso([[1, 0.25], [1.5, 0.25], [1.5, 1.75], [1, 1.75]], 'AAA', true);
    expect(n).toBe(2);
    // Both BBB regions were cut in two; AAA got the western halves of their middles.
    expect(Object.keys(doc().regions).length).toBe(6);
    const agg = countryAggregates(doc());
    expect(agg.BBB.area).toBeLessThan(before);
    expect(agg.AAA.area + agg.BBB.area).toBeCloseTo(48000, 3);
    // Population follows the land.
    expect(agg.AAA.vals.Population + agg.BBB.vals.Population).toBeCloseTo(400, 6);
    expect(agg.AAA.vals.Population).toBeGreaterThan(200);
    for (const g of Object.values(geoms())) expect(geomIssues(g)).toEqual([]);
    // The new pieces share their borders with what they were cut from and with AAA's land.
    const taken = Object.values(doc().regions).filter((r) => r.cid === 'AAA' && r.id > 1);
    expect(taken.length).toBe(2);
    for (const r of taken) expect(engine.neighbors(r.id).length).toBeGreaterThanOrEqual(2);
    undo();
    expect(Object.keys(doc().regions).length).toBe(4);
    expect(doc().regions[2].cid).toBe('BBB');
  });

  it('carves an enclave out of the middle of a region', () => {
    const n = paintLasso([[1.3, 0.3], [1.7, 0.3], [1.7, 0.7], [1.3, 0.7]], 'AAA', true);
    expect(n).toBe(1);
    const island = Object.values(doc().regions).find((r) => r.cid === 'AAA' && r.id > 1)!;
    expect(geomArea(geoms()[island.id]) / geomArea(sq(0, 0))).toBeCloseTo(0.16, 2);
    for (const g of Object.values(geoms())) expect(geomIssues(g)).toEqual([]);
  });
});

describe('freehand loops', () => {
  it('untangles a loop that crosses itself and keeps all it encloses', () => {
    // A figure eight, then a loop wound twice over the same square.
    const eight = loopShape([[0, 0], [2, 2], [2, 0], [0, 2]]) as unknown as number[][][][];
    expect(eight.length).toBe(2);
    const twice = loopShape([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0], [1, 0], [1, 1], [0, 1]]) as unknown as number[][][][];
    expect(twice.every((p) => p.length === 1)).toBe(true);
  });

  it('cuts a region the exact lasso covers almost whole, not taking the rest', () => {
    loadWorld(world());
    paintLasso([[0.99, -0.1], [2.1, -0.1], [2.1, 0.98], [0.99, 0.98]], 'AAA', 'exact');
    const left = Object.values(doc().regions).filter((r) => r.cid === 'BBB');
    expect(left.length).toBeGreaterThan(0);
    expect(left.some((r) => r.cy < 1)).toBe(true);
  });
});

describe('separating with the lasso', () => {
  it('takes a circled island off its region, exactly and without changing its owner', () => {
    // Region 2 gets an island out at sea.
    const b = world();
    const island = sq(4, 0.2, 0.5).coordinates;
    b.geoms[2] = { type: 'MultiPolygon', coordinates: [sq(1, 0).coordinates, island] } as never;
    loadWorld(b);
    const ids = separateLasso([[3.8, 0], [4.8, 0], [4.8, 1], [3.8, 1]]);
    expect(ids.length).toBe(1);
    const r = doc().regions[ids[0]];
    expect(r.cid).toBe('BBB');
    expect(ids[0]).not.toBe(2);
    // The island's own outline, untouched; the mainland is a plain polygon again.
    expect(geoms()[ids[0]]).toEqual({ type: 'Polygon', coordinates: island });
    expect(geoms()[2].type).toBe('Polygon');
    expect(r.area + doc().regions[2].area).toBeCloseTo(12000, 6);
    undo();
    expect(geoms()[2].type).toBe('MultiPolygon');
  });

  it('cuts a peninsula off along the loop, and just reports regions already separate', () => {
    loadWorld(world());
    const cut = separateLasso([[1.5, -0.1], [2.1, -0.1], [2.1, 0.6], [1.5, 0.6]]);
    expect(cut.length).toBe(1);
    expect(Object.keys(doc().regions).length).toBe(5);
    expect(doc().regions[cut[0]].cid).toBe('BBB');
    const whole = separateLasso([[-0.1, 0.996], [1.004, 0.996], [1.004, 2.1], [-0.1, 2.1]]);
    expect(whole).toEqual([1]);
    expect(Object.keys(doc().regions).length).toBe(5);
  });

  it('lets a plain lasso take just an island', () => {
    const b = world();
    b.geoms[2] = { type: 'MultiPolygon', coordinates: [sq(1, 0).coordinates, sq(4, 0.2, 0.5).coordinates] } as never;
    loadWorld(b);
    expect(paintLasso([[3.8, 0], [4.8, 0], [4.8, 1], [3.8, 1]], 'AAA', false)).toBe(1);
    expect(doc().regions[2].cid).toBe('BBB');
    expect(Object.values(doc().regions).filter((r) => r.cid === 'AAA').length).toBe(3);
  });
});

describe('cutting brush', () => {
  beforeEach(() => loadWorld(world()));

  it('sweeps a band and takes just that', () => {
    const shape = strokeShape([[1.5, 0.2], [1.5, 1.8]], 0.1);
    expect(shape).not.toBeNull();
    const n = paintStroke([[1.5, 0.2], [1.5, 1.8]], 0.1, 'AAA');
    expect(n).toBe(2);
    const agg = countryAggregates(doc());
    // A band 0.2 wide and ~1.8 long out of BBB's 2 square degrees.
    expect(agg.AAA.area - 24000).toBeGreaterThan(24000 * 0.12);
    expect(agg.AAA.area - 24000).toBeLessThan(24000 * 0.2);
    for (const g of Object.values(geoms())) expect(geomIssues(g)).toEqual([]);
  });

  it('takes a region whole when the brush covers nearly all of it', () => {
    const n = paintStroke([[1.5, 0.5]], 0.9, 'AAA');
    expect(n).toBeGreaterThanOrEqual(1);
    expect(doc().regions[2].cid).toBe('AAA');
  });
});

describe('snap to coast', () => {
  it('replaces a simplified coast by the detailed one, leaving inland borders alone', () => {
    // Two regions sharing the border x = 1, on an island whose real shore has a cape in the
    // south of the first and a bay in the south of the second.
    const real: LngLat[] = [[0, 1.02], [-0.02, 0.5], [0, 0.02], [0.5, -0.2], [1, 0.01], [1.5, 0.25], [2, 0.02], [2.02, 0.5], [2, 1.02], [1, 1.01]];
    const coast = new Coastline([real]);
    const geoms = { 0: sq(0, 0), 1: sq(1, 0) };
    const out = snapCoasts(geoms, coast, undefined, 0.35);
    expect(Object.keys(out).length).toBe(2);
    for (const g of Object.values(out)) expect(geomIssues(g)).toEqual([]);
    const pts = (g: Polygon) => g.coordinates[0].map((p) => p.join());
    // The bays are in, the shared border's ends are where they were.
    expect(pts(out[0] as Polygon)).toContain('0.5,-0.2');
    expect(pts(out[1] as Polygon)).toContain('1.5,0.25');
    for (const g of [out[0], out[1]] as Polygon[]) {
      expect(pts(g)).toContain('1,0');
      expect(pts(g)).toContain('1,1');
    }
    expect(geomArea(out[0])).toBeGreaterThan(geomArea(geoms[0]));
    expect(geomArea(out[1])).toBeLessThan(geomArea(geoms[1]));
  });

  it('leaves coasts with no coastline nearby as they are', () => {
    const coast = new Coastline([[[50, 50], [51, 50], [51, 51], [50, 51]]]);
    expect(snapCoasts({ 0: sq(0, 0) }, coast)).toEqual({});
  });
});

describe('draw to claim', () => {
  beforeEach(() => loadWorld(world()));

  it('takes whole countries when asked', () => {
    // A small loop in one corner of BBB.
    expect(paintLasso([[1.6, 0.1], [1.9, 0.1], [1.9, 0.4], [1.6, 0.4]], 'AAA', 'countries')).toBe(0);
    // Region 2 mostly circled: the whole of BBB follows.
    const n = paintLasso([[0.99, -0.1], [2.1, -0.1], [2.1, 1.01], [0.99, 1.01]], 'AAA', 'countries');
    expect(n).toBe(2);
    expect(Object.values(doc().regions).every((r) => r.cid === 'AAA')).toBe(true);
  });

  it('claims land and sea in one undo step', () => {
    // Half over region 2, half out at sea to the east.
    const n = paintLasso([[1.5, 0.2], [2.6, 0.2], [2.6, 0.8], [1.5, 0.8]], 'AAA', 'exact', true);
    expect(n).toBe(2);
    expect(Object.keys(doc().regions).length).toBe(6);
    const agg = countryAggregates(doc());
    expect(agg.AAA.regions).toBe(4);
    for (const g of Object.values(geoms())) expect(geomIssues(g)).toEqual([]);
    undo();
    expect(Object.keys(doc().regions).length).toBe(4);
    expect(doc().regions[2].cid).toBe('BBB');
  });
});

/** World with one huge region (BBB, 20×20°) next to a small one, plus a small island of BBB out at sea. */
function bigWorld(): WorldBundle {
  const b = world();
  // The big square has a vertex at (0, 1) too: neighbours share their border point for point.
  const big = [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 1], [0, 0]]];
  b.geoms = { 0: sq(-1, 0), 2: { type: 'MultiPolygon', coordinates: [big, sq(30, 5, 0.5).coordinates] } as never };
  b.doc.regions = {
    0: { ...b.doc.regions[0], cx: -0.5, cy: 0.5 },
    2: { ...b.doc.regions[2], area: 4.9e6, cx: 10, cy: 10 },
  };
  return b;
}

describe('claiming in huge regions and islands', () => {
  beforeEach(() => {
    setBarriers(null);
    useWorld.setState({ natural: { rivers: 'off', crests: false } });
    loadWorld(bigWorld());
  });

  it('a small loop in a huge region still takes what it circles', () => {
    // Under 1% of the region: it used to count as barely touched and take nothing.
    const n = paintLasso([[5, 5], [6.5, 5], [6.5, 6.2], [5, 6.2]], 'AAA', 'exact');
    expect(n).toBe(1);
    const taken = Object.values(doc().regions).filter((r) => r.cid === 'AAA' && r.id !== 0);
    expect(taken.length).toBe(1);
    expect(geomArea(geoms()[taken[0].id]) / geomArea(sq(5, 5, 1))).toBeCloseTo(1.8, 1);
  });

  it('a small brush stroke in a huge region takes the stroke', () => {
    expect(paintStroke([[5, 5], [7, 5]], 0.2, 'AAA')).toBe(1);
  });

  it('knows islands from parts that meet a neighbour', () => {
    expect(islandParts(2)).toEqual([false, true]);
  });

  it('a loop over part of an island takes the whole island, exactly', () => {
    expect(paintLasso([[30.1, 5.1], [30.45, 5.1], [30.45, 5.4], [30.1, 5.4]], 'AAA', 'exact')).toBe(1);
    const isl = Object.values(doc().regions).find((r) => r.cid === 'AAA' && r.id !== 0)!;
    expect(geoms()[isl.id]).toEqual(sq(30, 5, 0.5));
    expect(doc().regions[2].cid).toBe('BBB');
    // Switched off: just the part circled.
    undo();
    paintLasso([[30.1, 5.1], [30.45, 5.1], [30.45, 5.4], [30.1, 5.4]], 'AAA', 'exact', false, { islands: false });
    const part = Object.values(doc().regions).find((r) => r.cid === 'AAA' && r.id !== 0)!;
    expect(geomArea(geoms()[part.id])).toBeLessThan(geomArea(sq(30, 5, 0.5)) * 0.5);
  });

  it('an island too big for the screen is cut, not taken whole', () => {
    paintLasso([[30.1, 5.1], [30.45, 5.1], [30.45, 5.4], [30.1, 5.4]], 'AAA', 'exact', false, undefined, [30.05, 5.05, 30.47, 5.45]);
    const part = Object.values(doc().regions).find((r) => r.cid === 'AAA' && r.id !== 0)!;
    expect(geomArea(geoms()[part.id])).toBeLessThan(geomArea(sq(30, 5, 0.5)) * 0.5);
  });

  it('a brush tap on an island takes all of it', () => {
    expect(paintStroke([[30.25, 5.25]], 0.02, 'AAA')).toBe(1);
    const isl = Object.values(doc().regions).find((r) => r.cid === 'AAA' && r.id !== 0)!;
    expect(geoms()[isl.id]).toEqual(sq(30, 5, 0.5));
  });

  it('a plain brush dab on an island takes the island, not the mainland with it', () => {
    const ids = islandsUnder([2], [[30.2, 5.2]]);
    expect(ids.length).toBe(1);
    expect(ids[0]).not.toBe(2);
    expect(geoms()[ids[0]]).toEqual(sq(30, 5, 0.5));
    // On the mainland: the region, as it was.
    expect(islandsUnder([2], [[5, 5]])).toEqual([2]);
  });
});

describe('pockets closed off by rivers', () => {
  // A river crossing BBB's huge region from west to east at y ≈ 2, wiggling.
  const river = [[-0.5, 2], [6, 2.2], [12, 1.8], [20.5, 2]];
  const fc = (lines: number[][][]): FeatureCollection => ({
    type: 'FeatureCollection',
    features: lines.map((coordinates) => ({ type: 'Feature', properties: { scalerank: 1 }, geometry: { type: 'LineString', coordinates } })),
  });
  beforeEach(() => {
    loadWorld(bigWorld());
    setBarriers(new Barriers(fc([river]), fc([])));
    useWorld.setState({ natural: { rivers: 'all', crests: false } });
  });

  it('a loose loop around most of a pocket takes all of it, up to the river and no further', () => {
    // Most of the strip south of the river, spilling a little across it.
    const n = paintLasso([[2, -0.5], [20.5, -0.5], [20.5, 2.4], [2, 2.4]], 'AAA', 'exact');
    expect(n).toBeGreaterThanOrEqual(1);
    const taken = Object.values(doc().regions).filter((r) => r.cid === 'AAA' && r.id !== 0);
    const area = taken.reduce((t, r) => t + geomArea(geoms()[r.id]), 0);
    // The whole strip south of the river: about 20 × 2 degrees, the western end included.
    expect(area / geomArea(sq(0, 0, 1))).toBeGreaterThan(38);
    expect(area / geomArea(sq(0, 0, 1))).toBeLessThan(42);
    for (const r of taken) expect(r.cy).toBeLessThan(2);
    for (const g of Object.values(geoms())) expect(geomIssues(g)).toEqual([]);
  });

  it('without pockets the loop takes just what it circles', () => {
    paintLasso([[2, -0.5], [20.5, -0.5], [20.5, 2.4], [2, 2.4]], 'AAA', 'exact', false, { pockets: false });
    const taken = Object.values(doc().regions).filter((r) => r.cid === 'AAA' && r.id !== 0);
    const area = taken.reduce((t, r) => t + geomArea(geoms()[r.id]), 0);
    // Exactly the loop's 18 × 2.4 degrees, across the river too.
    expect(area / geomArea(sq(0, 0, 1))).toBeGreaterThan(42);
    expect(area / geomArea(sq(0, 0, 1))).toBeLessThan(44.5);
  });

  it('a brush tap takes the pocket under it', () => {
    paintStroke([[10, 1]], 0.1, 'AAA');
    const taken = Object.values(doc().regions).filter((r) => r.cid === 'AAA' && r.id !== 0);
    const area = taken.reduce((t, r) => t + geomArea(geoms()[r.id]), 0);
    expect(area / geomArea(sq(0, 0, 1))).toBeGreaterThan(38);
    expect(doc().regions[2].cid).toBe('BBB');
  });
});
