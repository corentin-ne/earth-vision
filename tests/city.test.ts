import { beforeEach, describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import type { WorldBundle } from '../src/types';
import { useWorld, loadWorld, undo, redo, deleteCity, currentBundle } from '../src/world/store';
import {
  addDistrict,
  addLine,
  addStop,
  deleteDistrict,
  deleteLine,
  deleteStation,
  districtsPop,
  lineKm,
  mergeDistricts,
  numberDistricts,
  planOf,
  removeStop,
  ringGeom,
  sharePopulation,
  sortedDistricts,
  transitFeatures,
  importLines,
  updateDistrict,
  updateStation,
  openCity,
} from '../src/world/city';
import { back } from '../src/world/cityBack';
import { useCityUi } from '../src/world/cityUi';
import { FINEST, MAIN, shownAreas, parseRoutes, joinRings, parseOverpass, relationGeom, simplify, townOf, townQuery } from '../src/io/osm';
import { exportAmap, importAmap } from '../src/io/amap';
import { pointInGeom } from '../src/geo/engine';

/** A small square around a point near Bordeaux, `s` degrees wide. */
const sq = (x: number, y: number, s = 0.02): Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });
const X = -0.58;
const Y = 44.84;
const CITY = 0;

function world(): WorldBundle {
  return {
    doc: {
      meta: { id: 't', title: 'T', created: 0, modified: 0, source: 'blank' },
      settings: { stats: [{ key: 'Population', scale: true }], fields: [], palette: ['#ff0000'] },
      countries: { FRA: { cid: 'FRA', name: 'France', color: '#ff0000', stats: {}, fields: {} } },
      regions: { 0: { id: 0, name: 'Gironde', cid: 'FRA', area: 10000, cx: X, cy: Y } },
      cities: { [CITY]: { id: CITY, name: 'Bordeaux', lng: X + 0.01, lat: Y + 0.01, capital: false, pop: 1_200_000 } },
      water: [],
      alliances: [],
    },
    geoms: { 0: sq(X - 1, Y - 1, 2) },
    flags: {},
  };
}

const plan = () => planOf(CITY);
const names = () => sortedDistricts(plan()).map((d) => d.name);

describe('city districts', () => {
  beforeEach(() => loadWorld(world()));

  it('adds districts side by side and undoes them', () => {
    const a = addDistrict(CITY, sq(X, Y), { name: 'Centre' })!;
    const b = addDistrict(CITY, sq(X + 0.02, Y), { name: 'Bastide' })!;
    expect(names()).toEqual(['Bastide', 'Centre']);
    // Neighbours that only share a border are left exactly as they were.
    expect(plan().districts[a].geom).toEqual(sq(X, Y));
    expect(plan().districts[a].area).toBeGreaterThan(3);
    expect(plan().districts[a].color).not.toBe(plan().districts[b].color);
    undo();
    expect(names()).toEqual(['Centre']);
    redo();
    expect(names()).toEqual(['Bastide', 'Centre']);
  });

  it('a district drawn over another takes its ground from it', () => {
    const big = addDistrict(CITY, sq(X, Y, 0.04), { name: 'Bordeaux Maritime', pop: 40_000 })!;
    const before = plan().districts[big].area;
    // Bassins à flot, carved out of a corner of it.
    const id = addDistrict(CITY, sq(X, Y, 0.02), { name: 'Bassins à flot', num: 7 })!;
    const rest = plan().districts[big];
    const mine = plan().districts[id];
    expect(mine.num).toBe(7);
    expect(rest.area + mine.area).toBeCloseTo(before, 3);
    expect(rest.area / before).toBeCloseTo(0.75, 2);
    // Its people come with the ground.
    expect(rest.pop! / 30_000).toBeCloseTo(1, 3);
    expect(rest.pop! + mine.pop!).toBe(40_000);
    expect(pointInGeom([X + 0.01, Y + 0.01], rest.geom)).toBe(false);
    expect(pointInGeom([X + 0.03, Y + 0.03], rest.geom)).toBe(true);
    // A district entirely covered disappears.
    addDistrict(CITY, sq(X - 0.01, Y - 0.01, 0.1), { name: 'Everything' });
    expect(names()).toEqual(['Everything']);
  });

  it('turns clicked points into a shape', () => {
    const g = ringGeom([[X, Y], [X + 0.02, Y], [X + 0.02, Y + 0.02], [X, Y + 0.02]])!;
    expect(pointInGeom([X + 0.01, Y + 0.01], g)).toBe(true);
    expect(ringGeom([[X, Y], [X + 0.02, Y]])).toBeNull();
  });

  it('merges districts and adds up their people', () => {
    const a = addDistrict(CITY, sq(X, Y), { name: 'A', pop: 100, num: 1 })!;
    const b = addDistrict(CITY, sq(X + 0.02, Y), { name: 'B', pop: 50 })!;
    const area = plan().districts[a].area + plan().districts[b].area;
    expect(mergeDistricts(CITY, [a, b])).toBe(a);
    expect(names()).toEqual(['A']);
    expect(plan().districts[a].pop).toBe(150);
    expect(plan().districts[a].num).toBe(1);
    expect(plan().districts[a].area).toBeCloseTo(area, 3);
    expect(plan().districts[a].geom.type).toBe('Polygon');
  });

  it('shares the city population exactly, by area then in proportion', () => {
    const a = addDistrict(CITY, sq(X, Y, 0.02), { name: 'Small' })!;
    const b = addDistrict(CITY, sq(X + 0.02, Y, 0.04), { name: 'Big' })!;
    sharePopulation(CITY, 1_200_000);
    expect(districtsPop(plan())).toBe(1_200_000);
    expect(plan().districts[b].pop! / plan().districts[a].pop!).toBeCloseTo(4, 1);
    // Once they have figures, a new total keeps each one's share.
    updateDistrict(CITY, a, { pop: 300_000 });
    updateDistrict(CITY, b, { pop: 100_000 });
    sharePopulation(CITY, 1_000_001);
    expect(districtsPop(plan())).toBe(1_000_001);
    expect(plan().districts[a].pop).toBe(750_001);
    expect(plan().districts[b].pop).toBe(250_000);
    // A district without a figure counts for its area, at the density of the others.
    const c = addDistrict(CITY, sq(X + 0.06, Y, 0.02), { name: 'New' })!;
    sharePopulation(CITY, 2_000_000);
    expect(districtsPop(plan())).toBe(2_000_000);
    expect(plan().districts[c].pop).toBeGreaterThan(100_000);
    expect(plan().districts[a].pop! / plan().districts[b].pop!).toBeCloseTo(3, 2);
  });

  it('numbers districts from the centre outwards', () => {
    addDistrict(CITY, sq(X + 0.06, Y), { name: 'Far' });
    addDistrict(CITY, sq(X, Y), { name: 'Centre' });
    addDistrict(CITY, sq(X + 0.03, Y), { name: 'Near' });
    numberDistricts(CITY);
    expect(sortedDistricts(plan()).map((d) => `${d.num} ${d.name}`)).toEqual(['1 Centre', '2 Near', '3 Far']);
  });

  it('forgets the plan with the city, and brings it back on undo', () => {
    const a = addDistrict(CITY, sq(X, Y), { name: 'A' })!;
    deleteDistrict(CITY, a);
    expect(names()).toEqual([]);
    undo();
    deleteCity(CITY);
    expect(useWorld.getState().doc!.plans?.[CITY]).toBeUndefined();
    undo();
    expect(names()).toEqual(['A']);
  });
});

describe('city transit', () => {
  beforeEach(() => loadWorld(world()));

  it('grows a line from the nearer end and inserts stops on it', () => {
    const l = addLine(CITY);
    expect(plan().lines[l].name).toBe('M1');
    const a = addStop(CITY, l, [X, Y], { name: 'Quinconces' })!;
    const b = addStop(CITY, l, [X + 0.02, Y])!;
    // Beyond the first stop: it becomes the new start. Beyond the last: the new end.
    const before = addStop(CITY, l, [X - 0.02, Y])!;
    const after = addStop(CITY, l, [X + 0.04, Y])!;
    expect(plan().lines[l].stops).toEqual([before, a, b, after]);
    const mid = addStop(CITY, l, [X + 0.01, Y], { index: 2 })!;
    expect(plan().lines[l].stops).toEqual([before, a, mid, b, after]);
    expect(plan().stations[a].name).toBe('Quinconces');
    expect(new Set(Object.values(plan().stations).map((s) => s.name)).size).toBe(5);
    expect(lineKm(plan(), plan().lines[l])).toBeCloseTo(4.73, 1);
    undo();
    expect(plan().lines[l].stops).toEqual([before, a, b, after]);
  });

  it('shares stations between lines and drops the orphans', () => {
    const m1 = addLine(CITY);
    const m2 = addLine(CITY, 'tram');
    expect(plan().lines[m2].name).toBe('T1');
    expect(plan().lines[m2].color).not.toBe(plan().lines[m1].color);
    const a = addStop(CITY, m1, [X, Y])!;
    const b = addStop(CITY, m1, [X + 0.02, Y])!;
    const c = addStop(CITY, m2, [X, Y + 0.02])!;
    // An existing station joins the other line: an interchange, not a copy.
    expect(addStop(CITY, m2, a)).toBe(a);
    expect(addStop(CITY, m2, a)).toBeNull();
    expect(Object.keys(plan().stations)).toHaveLength(3);
    const f = transitFeatures(plan());
    expect(f.stations.features.find((s) => s.properties!.id === a)!.properties!.hub).toBe(true);
    expect(f.stations.features.find((s) => s.properties!.id === b)!.properties!.hub).toBe(false);

    removeStop(CITY, m1, a);
    expect(plan().stations[a]).toBeDefined();
    deleteLine(CITY, m2);
    expect(Object.keys(plan().stations)).toEqual([b]);
    undo();
    expect(Object.keys(plan().stations).sort()).toEqual([a, b, c].sort());
    deleteStation(CITY, a);
    expect(plan().lines[m2].stops).toEqual([c]);
  });

  it('draws lines that share a stretch side by side', () => {
    const m1 = addLine(CITY);
    const m2 = addLine(CITY);
    const a = addStop(CITY, m1, [X, Y])!;
    const b = addStop(CITY, m1, [X + 0.02, Y])!;
    addStop(CITY, m1, [X + 0.04, Y]);
    // The second line runs the shared stretch the other way round.
    addStop(CITY, m2, b);
    addStop(CITY, m2, a, { index: 1 });
    const f = transitFeatures(plan()).lines.features;
    const shared = f.filter((x) => JSON.stringify(x.geometry.coordinates) === JSON.stringify(f.find((y) => y.properties!.line === m2)!.geometry.coordinates));
    expect(shared).toHaveLength(2);
    expect(shared.map((x) => x.properties!.offset).sort()).toEqual([-0.5, 0.5]);
    expect(f.filter((x) => x.properties!.line === m1 && x.properties!.offset === 0)).toHaveLength(1);
  });

  it('moves a station in one undo step', () => {
    const l = addLine(CITY);
    const a = addStop(CITY, l, [X, Y])!;
    for (let i = 1; i <= 5; i++) updateStation(CITY, a, { lng: X + i * 0.001, lat: Y }, 'Move station', 'move:1');
    expect(plan().stations[a].lng).toBeCloseTo(X + 0.005, 6);
    undo();
    expect(plan().stations[a].lng).toBe(X);
  });
});

describe('real rail network', () => {
  beforeEach(() => loadWorld(world()));
  const node = (id: number, name: string, dx: number, dy = 0) => ({ type: 'node', id, lon: X + dx, lat: Y + dy, tags: { name } });
  const route = (id: number, tags: Record<string, string>, stops: number[], role = 'stop') => ({
    type: 'relation',
    id,
    tags: { type: 'route', ...tags },
    members: [{ type: 'way', ref: 1, role: '' }, ...stops.map((ref) => ({ type: 'node', ref, role }))],
  });
  const answer = {
    elements: [
      node(1, 'Quinconces', 0),
      node(2, 'Hôtel de Ville', 0.01),
      node(3, 'Gare', 0.02),
      // The other platform of the same station, a few metres away.
      node(4, 'Hôtel de Ville', 0.0101, 0.0001),
      node(5, 'Mériadeck', 0.01, 0.01),
      route(10, { route: 'tram', ref: 'A', colour: '#81197f' }, [1, 2, 3]),
      // The way back, and a short working: one line all the same.
      route(11, { route: 'tram', ref: 'A' }, [3, 2, 1]),
      route(12, { route: 'tram', ref: 'A' }, [1, 2]),
      route(13, { route: 'subway', ref: '1' }, [5, 4], 'platform'),
      route(14, { route: 'bus', ref: '9' }, [1, 2]),
      route(15, { route: 'train', name: 'RER C' }, [3]),
    ],
  };

  it('reads metros and trams once each, with their stops in order', () => {
    const lines = parseRoutes(answer);
    expect(lines.map((l) => `${l.mode} ${l.name}`)).toEqual(['metro 1', 'tram A']);
    expect(lines[1].color).toBe('#81197F');
    expect(lines[1].stops.map((s) => s.name)).toEqual(['Quinconces', 'Hôtel de Ville', 'Gare']);
    expect(lines[0].stops.map((s) => s.name)).toEqual(['Mériadeck', 'Hôtel de Ville']);
  });

  it('brings them in as one undo step, meeting in interchanges', () => {
    const mine = addLine(CITY);
    const gare = addStop(CITY, mine, [X + 0.02, Y], { name: 'Gare' })!;
    addStop(CITY, mine, [X + 0.03, Y]);
    expect(importLines(CITY, parseRoutes(answer))).toBe(2);
    const p = plan();
    const tram = Object.values(p.lines).find((l) => l.name === 'A')!;
    const metro = Object.values(p.lines).find((l) => l.name === '1')!;
    // The existing Gare is reused; both platforms of Hôtel de Ville are one station.
    expect(tram.stops[2]).toBe(gare);
    expect(metro.stops[1]).toBe(tram.stops[1]);
    expect(Object.keys(p.stations)).toHaveLength(5);
    expect(metro.color).not.toBe(p.lines[mine].color);
    // Importing again adds nothing.
    expect(importLines(CITY, parseRoutes(answer))).toBe(0);
    undo();
    expect(Object.keys(plan().lines)).toEqual([mine]);
  });
});

describe('city view', () => {
  beforeEach(() => loadWorld(world()));

  it('opens from the map and steps back out', () => {
    openCity(CITY);
    expect(useWorld.getState().cityView).toBe(CITY);
    useCityUi.setState({ tool: 'draw', district: 'x' });
    expect(back()).toBe(true);
    expect(useCityUi.getState().tool).toBe('pick');
    back();
    expect(useCityUi.getState().district).toBeNull();
    back();
    expect(useWorld.getState().cityView).toBeNull();
    expect(back()).toBe(false);
    openCity(99);
    expect(useWorld.getState().cityView).toBeNull();
  });

  it('travels in the .map file', async () => {
    const d = addDistrict(CITY, sq(X, Y), { name: 'Bassins à flot', num: 7, pop: 12_000 })!;
    const l = addLine(CITY);
    addStop(CITY, l, [X, Y], { name: 'Cité du Vin' });
    addStop(CITY, l, [X + 0.02, Y]);
    const again = importAmap(await exportAmap(currentBundle()), 'city.map');
    const p = again.doc.plans![CITY];
    expect(p.districts[d]).toMatchObject({ name: 'Bassins à flot', num: 7, pop: 12_000 });
    expect(p.districts[d].geom).toEqual(sq(X, Y));
    expect(p.lines[l].stops).toHaveLength(2);
    expect(Object.values(p.stations).map((s) => s.name)).toContain('Cité du Vin');
    // A world without plans writes none.
    loadWorld(world());
    expect(importAmap(await exportAmap(currentBundle()), 'city.map').doc.plans).toBeUndefined();
  });
});

describe('real districts from OpenStreetMap', () => {
  const way = (pts: [number, number][], role = 'outer') => ({ type: 'way', role, geometry: pts.map(([lon, lat]) => ({ lon, lat })) });

  it('joins ways into rings whatever their order and direction', () => {
    const rings = joinRings([
      [[0, 0], [1, 0]],
      [[1, 1], [1, 0]],
      [[1, 1], [0, 1], [0, 0]],
      [[5, 5], [6, 5]],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0][0]).toEqual(rings[0][rings[0].length - 1]);
    expect(rings[0]).toHaveLength(5);
  });

  it('simplifies a shared border the same way for both neighbours', () => {
    // A wiggly border between two areas, listed in opposite directions.
    const border: [number, number][] = Array.from({ length: 40 }, (_, i) => [X + 0.02 + Math.sin(i) * 1e-4, Y + i * 0.0005]);
    const top = border[border.length - 1];
    const left = { type: 'relation', id: 1, tags: { admin_level: '10', name: 'Left' }, members: [way(border), way([top, [X, top[1]], [X, Y], border[0]])] };
    const right = { type: 'relation', id: 2, tags: { admin_level: '10', name: 'Right', population: '2500' }, members: [way([...border].reverse()), way([border[0], [X + 0.04, Y], [X + 0.04, top[1]], top])] };
    const a = relationGeom(left)! as Polygon;
    const b = relationGeom(right)! as Polygon;
    const pts = (g: Polygon) => new Set(g.coordinates[0].map((p) => p.join(',')));
    const shared = [...pts(a)].filter((p) => pts(b).has(p));
    expect(shared.length).toBeGreaterThan(2);
    expect(shared.length).toBeLessThan(40);
    expect(simplify([[0, 0], [1, 1e-7], [2, 0]], 1e-5)).toEqual([[0, 0], [2, 0]]);

    const found = parseOverpass({ elements: [left, right, { type: 'relation', id: 3, tags: { admin_level: '8' }, members: [] }] });
    expect(found.map((c) => c.name)).toEqual(['Left', 'Right']);
    expect(found[1]).toMatchObject({ id: 'r2', level: 10, pop: 2500 });
    expect(found[0].area).toBeGreaterThan(1);

    // Added one after the other, neither bites into its neighbour.
    loadWorld(world());
    const l = addDistrict(CITY, found[0].geom, { name: 'Left', src: found[0].id })!;
    addDistrict(CITY, found[1].geom, { name: 'Right', src: found[1].id });
    expect(plan().districts[l].geom).toEqual(found[0].geom);
  });

  it('asks only for the town, its quarters and its neighbours', () => {
    const rel = (id: number, level: string) => ({ type: 'relation', id, tags: { admin_level: level } });
    // Around a point in Paris: the country down to a quarter. The town is the commune, not its arrondissement.
    const town = townOf([rel(1, '2'), rel(2, '4'), rel(3, '6'), rel(7444, '8'), rel(5, '9'), rel(6, '10')])!;
    expect(town).toEqual({ id: 7444, level: 8 });
    const q = townQuery(town);
    expect(q).toContain('rel(7444)->.t;');
    expect(q).toContain('["admin_level"="8"]');
    expect(q).toContain('"^(9|10)$"');
    // A city-state like Berlin (level 4): its boroughs and localities, whatever their levels.
    expect(townQuery(townOf([rel(1, '2'), rel(62422, '4'), rel(9, '9')])!)).toContain('"^(5|6|7|8|9|10)$"');
    expect(townOf([rel(1, '2'), rel(9, '10')])).toBeNull();
    // Growing past the first ring asks for a town's neighbours only, not its quarters again.
    const more = townQuery(town, false);
    expect(more).toContain('["admin_level"="8"]');
    expect(more).not.toContain('map_to_area');
  });

  it('offers arrondissements and neighbouring towns before the quarters inside them', () => {
    const area = (id: string, level: number, x: number, y: number, s: number) => ({ id, name: id, level, geom: sq(x, y, s), area: s * s });
    const areas = [
      area('Paris', 8, 0, 0, 4),
      area('1er', 9, 0, 0, 2),
      area('2e', 9, 2, 0, 2),
      area('Halles', 10, 0, 0, 1),
      area('Palais-Royal', 10, 1, 0, 1),
      area('Montreuil', 8, 4, 0, 2),
    ];
    const ids = (level: number) => shownAreas(areas, level).map((a) => a.id).sort();
    expect(ids(MAIN)).toEqual(['1er', '2e', 'Montreuil']);
    expect(ids(FINEST)).toEqual(['2e', 'Halles', 'Montreuil', 'Palais-Royal']);
    expect(ids(8)).toEqual(['Montreuil', 'Paris']);
  });

  it('keeps holes and drops what is too big to be a district', () => {
    const outer = way([[X, Y], [X + 0.1, Y], [X + 0.1, Y + 0.1], [X, Y + 0.1], [X, Y]]);
    const inner = way([[X + 0.04, Y + 0.04], [X + 0.06, Y + 0.04], [X + 0.06, Y + 0.06], [X + 0.04, Y + 0.06], [X + 0.04, Y + 0.04]], 'inner');
    const g = relationGeom({ type: 'relation', id: 1, members: [outer, inner] })!;
    expect(g.type).toBe('Polygon');
    expect((g as Polygon).coordinates).toHaveLength(2);
    const huge = { type: 'relation', id: 9, tags: { admin_level: '6', name: 'County' }, members: [way([[0, 40], [2, 40], [2, 42], [0, 42], [0, 40]])] };
    expect(parseOverpass({ elements: [huge] })).toEqual([]);
  });
});
