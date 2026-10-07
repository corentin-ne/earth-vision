import { describe, expect, it } from 'vitest';
import type { MultiLineString, Polygon } from 'geojson';
import { GeoEngine, geomArea, labelPoint } from '../src/geo/engine';
import { insertCutVertices, splitGeom } from '../src/geo/split';

const sq = (x: number, y: number, s = 1): Polygon => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]],
});

const len = (ml: MultiLineString) =>
  ml.coordinates.reduce((s, l) => s + l.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - l[i][0], p[1] - l[i][1]), 0), 0);

// 2×2 grid of unit squares: 0 1 / 2 3
const grid = { 0: sq(0, 1), 1: sq(1, 1), 2: sq(0, 0), 3: sq(1, 0) };

describe('GeoEngine', () => {
  it('classifies borders by owner', () => {
    const e = new GeoEngine();
    e.build(grid);
    const b = e.borders((id) => (id < 2 ? 'A' : 'B'));
    expect(len(b.countries)).toBeCloseTo(2); // the horizontal middle line
    expect(len(b.regions)).toBeCloseTo(2); // the vertical middle line
    expect(len(b.coast)).toBeCloseTo(8); // the outer square
  });

  it('merges regions on shared arcs', () => {
    const e = new GeoEngine();
    e.build(grid);
    const m = e.merge([0, 1, 2, 3])!;
    expect(m.coordinates).toHaveLength(1);
    expect(geomArea(m)).toBeCloseTo(geomArea(sq(0, 0, 2)), 3);
  });

  it('finds neighbours', () => {
    const e = new GeoEngine();
    e.build(grid);
    expect(e.neighbors(0).sort()).toEqual([1, 2]);
  });

  it('puts labels inside the shape', () => {
    const p = labelPoint(sq(10, 10, 4))!;
    expect(p[0]).toBeGreaterThan(10);
    expect(p[0]).toBeLessThan(14);
  });
});

describe('split', () => {
  it('cuts a square in two along a line', () => {
    const pieces = splitGeom(sq(0, 0, 2), [
      [1, -1],
      [1, 3],
    ])!;
    expect(pieces).not.toBeNull();
    const [a, b] = pieces.map(geomArea);
    expect(a + b).toBeCloseTo(geomArea(sq(0, 0, 2)), 3);
    expect(a / b).toBeCloseTo(1, 1);
  });

  it('cuts with a line that ends inside the region', () => {
    const pieces = splitGeom(sq(0, 0, 2), [
      [0.5, 1],
      [1.5, 1],
    ]);
    expect(pieces).not.toBeNull();
  });

  it('returns null when the line misses', () => {
    expect(
      splitGeom(sq(0, 0, 1), [
        [5, 5],
        [6, 6],
      ]),
    ).toBeNull();
  });

  it('adds the new border vertices to neighbours so arcs stay shared', () => {
    const left = sq(0, 0, 2);
    const right = sq(2, 0, 2);
    const pieces = splitGeom(left, [
      [-1, 1.3],
      [3, 0.7],
    ])!;
    const fixed = insertCutVertices(pieces, left, { 1: right });
    expect(fixed[1]).toBeDefined();
    const e = new GeoEngine();
    e.build({ 0: pieces[0], 2: pieces[1], 1: fixed[1] });
    // The shared edge with the right square must not show up as coastline.
    expect(len(e.borders(() => 'X').coast)).toBeCloseTo(12, 3);
  });
});
