import { beforeEach, describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import type { WorldBundle } from '../src/types';
import { useWorld, loadWorld, transferRegions, annexCountry, createCountry, splitAlong, undo, redo, currentBundle, setTool } from '../src/world/store';
import { addChapter, deleteChapter, moveChapter, recaptureChapter, restoreChapter, stepChapter, updateChapter, viewChapter } from '../src/world/timeline';
import { eraChanges, ownerIndex, sortedEras } from '../src/world/eras';
import { exportAmap, importAmap } from '../src/io/amap';
import { distanceKm, pathLength, ringArea } from '../src/geo/measure';

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
    regions[i] = { id: i, name: `R${i}`, cid: owners[x], area: 12300, cx: x + 0.5, cy: y + 0.5, vals: { Population: 100 } };
  }
  const country = (cid: string, name: string, color: string) => ({ cid, name, color, stats: { GDP: 1000 }, fields: {} });
  return {
    doc: {
      meta: { id: 't', title: 'T', created: 0, modified: 0, source: 'blank' },
      settings: { stats: [{ key: 'Population', scale: true }, { key: 'GDP', scale: false }], fields: [], palette: ['#ff0000', '#00ff00', '#0000ff'] },
      countries: { AAA: country('AAA', 'Aland', '#ff0000'), BBB: country('BBB', 'Bland', '#00ff00'), CCC: country('CCC', 'Cland', '#0000ff') },
      regions,
      cities: {},
      water: [],
      alliances: [{ id: 'al', name: 'Pact', color: '#123456', members: ['AAA', 'BBB'] }],
    },
    geoms,
    flags: {},
  };
}

const st = () => useWorld.getState();
const doc = () => st().doc!;
const owners = () => Object.values(doc().regions).map((r) => r.cid).join(',');

describe('timeline', () => {
  beforeEach(() => loadWorld(world()));

  it('keeps chapters, shows them read-only and comes back to the present', () => {
    const start = owners();
    const a = addChapter('Before the war', '1900')!;
    annexCountry('BBB', 'AAA');
    const after = owners();
    const b = addChapter('After the war', '1905')!;
    expect(sortedEras(doc()).map((e) => e.name)).toEqual(['Before the war', 'After the war']);

    viewChapter(a);
    expect(st().era).toBe(a);
    expect(owners()).toBe(start);
    // The annexed country is back, with what it was.
    expect(doc().countries.BBB.name).toBe('Bland');
    expect(doc().alliances[0].members).toEqual(['AAA']);
    // What is saved and exported stays the present.
    expect(Object.values(currentBundle().doc.regions).map((r) => r.cid).join(',')).toBe(after);

    // The past cannot be edited: neither the map, nor through undo, nor with the editing tools.
    transferRegions([0], 'CCC');
    expect(owners()).toBe(start);
    undo();
    expect(st().present!.countries.BBB).toBeUndefined();
    setTool('paint');
    expect(st().tool).toBe('select');

    viewChapter(b);
    expect(owners()).toBe(after);
    expect(doc().countries.BBB).toBeUndefined();
    viewChapter(null);
    expect(st().present).toBeNull();
    expect(owners()).toBe(after);
    transferRegions([0], 'CCC');
    expect(doc().regions[0].cid).toBe('CCC');
  });

  it('edits and reorders chapters while one is shown', () => {
    const a = addChapter('One')!;
    transferRegions([1], 'AAA');
    const b = addChapter('Two')!;
    viewChapter(a);
    updateChapter(a, { name: 'First', date: '12', notes: 'It began.' });
    expect(st().era).toBe(a);
    expect(doc().regions[1].cid).toBe('BBB');
    expect(st().present!.timeline!.find((e) => e.id === a)).toMatchObject({ name: 'First', date: '12', notes: 'It began.' });
    moveChapter(a, 1);
    expect(sortedEras(st().present).map((e) => e.id)).toEqual([b, a]);
    // Past the last chapter comes the present.
    expect(stepChapter(1)).toBe(true);
    expect(st().era).toBeNull();
    expect(stepChapter(1)).toBe(false);
    expect(stepChapter(-1)).toBe(true);
    expect(st().era).toBe(a);
    deleteChapter(a);
    expect(st().era).toBeNull();
    expect(doc().timeline!.map((e) => e.id)).toEqual([b]);
    undo();
    expect(doc().timeline!.length).toBe(2);
  });

  it('returns the world to a chapter in one undo step, countries included', () => {
    const start = owners();
    const a = addChapter('Then')!;
    annexCountry('BBB', 'AAA');
    const nid = createCountry('Newland', [2]);
    const changed = owners();
    restoreChapter(a);
    expect(owners()).toBe(start);
    expect(doc().countries.BBB.name).toBe('Bland');
    // A country born since keeps existing, without land.
    expect(doc().countries[nid]).toBeDefined();
    undo();
    expect(owners()).toBe(changed);
    expect(doc().countries.BBB).toBeUndefined();
    redo();
    expect(owners()).toBe(start);
  });

  it('gives the pieces of a region cut later to whoever held it then', () => {
    const a = addChapter('Then')!;
    transferRegions([0], 'CCC');
    expect(splitAlong([[0.5, -1], [0.5, 2]], [0])).toBe(1);
    const pieces = Object.values(doc().regions).filter((r) => r.name.startsWith('R0'));
    expect(pieces.length).toBe(2);
    const idx = ownerIndex(doc().timeline!.find((e) => e.id === a)!);
    for (const p of pieces) expect(idx.get(p.id)).toBe('AAA');
    viewChapter(a);
    for (const p of pieces) expect(doc().regions[p.id].cid).toBe('AAA');
    viewChapter(null);
    // Undoing the cut takes the pieces out of the chapter again.
    undo();
    expect(ownerIndex(doc().timeline![0]).size).toBe(6);
  });

  it('overwrites a chapter and tells who gained and lost land', () => {
    const a = addChapter('Then')!;
    transferRegions([1, 4], 'AAA');
    const ch = eraChanges(doc(), doc().timeline![0], null);
    expect(ch.find((c) => c.cid === 'AAA')!.delta).toBeCloseTo(24600);
    expect(ch.find((c) => c.cid === 'BBB')).toMatchObject({ kind: 'gone' });
    recaptureChapter(a);
    expect(eraChanges(doc(), doc().timeline![0], null)).toEqual([]);
  });

  it('survives a .map round trip', async () => {
    addChapter('Then', '1900');
    transferRegions([1], 'AAA');
    const back = importAmap(await exportAmap(currentBundle()));
    expect(back.doc.timeline?.[0]).toMatchObject({ name: 'Then', date: '1900' });
    expect(back.doc.timeline![0].own.BBB.sort()).toEqual([1, 4]);
  });
});

describe('measure', () => {
  it('measures great-circle distances and areas', () => {
    expect(distanceKm([0, 0], [0, 1])).toBeCloseTo(111.2, 0);
    expect(pathLength([[0, 0], [0, 1], [0, 2]])).toBeCloseTo(222.4, 0);
    // One degree square on the equator: about 12,300 km².
    expect(ringArea([[0, 0], [1, 0], [1, 1], [0, 1]])).toBeGreaterThan(12000);
    expect(ringArea([[0, 0], [1, 0], [1, 1], [0, 1]])).toBeLessThan(12500);
    expect(ringArea([[0, 0], [1, 0]])).toBe(0);
  });
});
