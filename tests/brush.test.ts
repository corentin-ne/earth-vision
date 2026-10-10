import { beforeEach, describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import type { LngLat, WorldBundle } from '../src/types';
import { useWorld, loadWorld, undo, engine, countryAggregates } from '../src/world/store';
import { paintLasso, paintStroke, strokeShape } from '../src/world/brush';
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
