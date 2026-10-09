import { describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import type { RegionGeom, WorldBundle } from '../src/types';
import { cleanGeom, geomIssues, repairGeom } from '../src/geo/repair';
import { geomArea } from '../src/geo/engine';
import { useWorld, loadWorld, mergeRegions, commit } from '../src/world/store';

const sq = (x: number, y: number, s = 1): Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });
const area = (g: RegionGeom | null) => (g ? geomArea(g) : 0);

describe('shape validation', () => {
  it('accepts a clean square and flags broken rings', () => {
    expect(geomIssues(sq(0, 0))).toEqual([]);
    const open: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] };
    expect(geomIssues(open).join()).toMatch(/not closed/);
    const spike: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [2, 0.5], [1, 0], [1, 1], [0, 1], [0, 0]]] };
    expect(geomIssues(spike).join()).toMatch(/spike/);
    const strayHole: Polygon = { type: 'Polygon', coordinates: [sq(0, 0).coordinates[0], sq(5, 5).coordinates[0]] };
    expect(geomIssues(strayHole).join()).toMatch(/outside/);
  });

  it('joins an outline that came out in open pieces', () => {
    // A square's outline in three open pieces, in the wrong order: what a failed arc merge leaves.
    const broken: Polygon = {
      type: 'Polygon',
      coordinates: [
        [[2, 0], [2, 2], [1, 2]],
        [[0, 0], [1, 0], [2, 0]],
        [[1, 2], [0, 2], [0, 0]],
      ],
    };
    const fixed = repairGeom(broken)!;
    expect(geomIssues(fixed)).toEqual([]);
    expect(area(fixed)).toBeCloseTo(area(sq(0, 0, 2)), 6);
  });

  it('takes a lost stretch of border from the neighbours, not a straight line', () => {
    // The left edge of the region is missing; its neighbour on the left still has it, with a bend.
    const broken: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2]]] };
    const neighbour = [[[-1, 0], [0, 0], [0.5, 1], [0, 2], [-1, 2], [-1, 0]]];
    const fixed = repairGeom(broken, neighbour)!;
    expect(geomIssues(fixed)).toEqual([]);
    // The repaired edge follows the neighbour's bend (0.5, 1) instead of cutting straight across.
    const ring = (fixed as Polygon).coordinates[0];
    expect(ring.some(([x, y]) => x === 0.5 && y === 1)).toBe(true);
  });

  it('removes spikes and puts a stray hole back as its own shape', () => {
    const spike: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [2, 0.5], [1, 0], [1, 1], [0, 1], [0, 0]]] };
    const fixed = cleanGeom(spike);
    expect(geomIssues(fixed)).toEqual([]);
    expect(area(fixed)).toBeCloseTo(area(sq(0, 0)), 6);
  });
});

describe('editing never stores a broken shape', () => {
  function world(): WorldBundle {
    const geoms: WorldBundle['geoms'] = {};
    const regions: WorldBundle['doc']['regions'] = {};
    for (let i = 0; i < 4; i++) {
      geoms[i] = sq(i, 0);
      regions[i] = { id: i, name: `R${i}`, cid: 'AAA', area: geomArea(geoms[i]), cx: i + 0.5, cy: 0.5 };
    }
    // A T-junction: region 1's left edge has an extra point region 0's right edge lacks.
    geoms[1] = { type: 'Polygon', coordinates: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0.5], [1, 0]]] };
    return {
      doc: {
        meta: { id: 'r', title: 'R', created: 0, modified: 0, source: 'blank' },
        settings: { stats: [], fields: [], palette: ['#FF0000'] },
        countries: { AAA: { cid: 'AAA', name: 'Aland', color: '#FF0000', stats: {}, fields: {} } },
        regions,
        cities: {},
        water: [],
        alliances: [],
      },
      geoms,
      flags: {},
    } as unknown as WorldBundle;
  }

  it('merges regions whose borders do not match point for point into one valid shape', () => {
    loadWorld(world());
    const id = mergeRegions([0, 1, 2])!;
    const g = useWorld.getState().geoms[id];
    expect(geomIssues(g)).toEqual([]);
    expect(area(g)).toBeCloseTo(area(sq(0, 0)) * 3, 6);
  });

  it('repairs a broken shape handed to an edit', () => {
    loadWorld(world());
    const open: Polygon = { type: 'Polygon', coordinates: [[[3, 0], [4, 0], [4, 1], [3, 1]]] };
    commit('test', { geoms: { 3: open } });
    expect(geomIssues(useWorld.getState().geoms[3])).toEqual([]);
  });

  it('repairs broken shapes when a world opens', () => {
    const w = world();
    w.geoms[2] = { type: 'Polygon', coordinates: [[[2, 0], [3, 0], [3, 1]], [[3, 1], [2, 1], [2, 0]]] };
    loadWorld(w);
    const g = useWorld.getState().geoms[2];
    expect(geomIssues(g)).toEqual([]);
    expect(area(g)).toBeCloseTo(area(sq(2, 0)), 3);
  });
});
