import { describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import { GeoEngine } from '../src/geo/engine';
import { healGeoms } from '../src/geo/heal';

const poly = (pts: number[][]): Polygon => ({ type: 'Polygon', coordinates: [[...pts, pts[0]]] });

describe('healGeoms', () => {
  it('closes a sliver gap and a missing vertex between neighbours', () => {
    // Left square's right edge sits 0.001 off the right square, and the right one has an extra vertex.
    const geoms = {
      0: poly([[0, 0], [0.999, 0], [0.999, 1], [0, 1]]),
      1: poly([[1, 0], [2, 0], [2, 1], [1, 1], [1, 0.5]]),
    };
    const e = new GeoEngine();
    e.build(geoms);
    expect(e.borders(() => 'A').regions.coordinates).toHaveLength(0);

    const healed = { ...geoms, ...healGeoms(geoms, 0.01) };
    e.build(healed);
    const b = e.borders(() => 'A');
    expect(b.regions.coordinates.length).toBeGreaterThan(0);
  });

  it('leaves clean topology untouched', () => {
    const geoms = { 0: poly([[0, 0], [1, 0], [1, 1], [0, 1]]), 1: poly([[1, 0], [2, 0], [2, 1], [1, 1]]) };
    expect(Object.keys(healGeoms(geoms))).toHaveLength(0);
  });
});
