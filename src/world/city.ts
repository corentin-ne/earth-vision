// A city seen up close: its districts (arrondissements, quarters…) and its transit network.
// Plans live in the world document (`doc.plans`, by city id), so they are saved, exported and
// undone like everything else.
import { difference, union, type Geom } from 'polyclip-ts';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { CityPlan, District, LngLat, RegionGeom, Station, TransitLine, TransitMode } from '../types';
import { commit, select, setTool, toast, useWorld } from './store';
import { geomArea, labelPoint, pointInGeom } from '../geo/engine';
import { distanceKm } from '../geo/measure';
import { uid } from '../util';

const EMPTY: CityPlan = { districts: {}, stations: {}, lines: {} };

/** Soft colours for districts: they sit under street names and transit lines. */
export const DISTRICT_COLORS = ['#F2A65A', '#6FB1E8', '#8FCB7C', '#E58FB1', '#B79CE8', '#5CC9B5', '#EBCB5C', '#E8826F', '#7C9BE0', '#A9C95C', '#D99AD6', '#6DC3D9'];
/** Strong colours for lines, in the order new lines take them. */
export const LINE_COLORS = ['#E3242B', '#0A6FD6', '#16A34A', '#F59E0B', '#8B3FD9', '#EC4899', '#0EA5A4', '#92501C', '#84CC16', '#475569', '#F97316', '#06B6D4'];

export const MODES: Record<TransitMode, { label: string; prefix: string }> = {
  metro: { label: 'Metro', prefix: 'M' },
  tram: { label: 'Tram', prefix: 'T' },
  train: { label: 'Train', prefix: 'R' },
  bus: { label: 'Bus', prefix: 'B' },
};

const newId = () => uid().slice(0, 8);

export function planOf(cityId: number | null | undefined): CityPlan {
  return (cityId != null && useWorld.getState().doc?.plans?.[cityId]) || EMPTY;
}

function put(cityId: number, label: string, plan: CityPlan, group?: string) {
  if (!useWorld.getState().doc?.cities[cityId]) return;
  commit(label, { plans: { [cityId]: plan } }, { group });
}

/** Opens a city up close (or goes back to the world with `null`). */
export function openCity(cityId: number | null) {
  const s = useWorld.getState();
  if (cityId != null && !s.doc?.cities[cityId]) return;
  if (cityId != null) {
    setTool('select');
    select({ city: cityId });
  }
  useWorld.setState({ cityView: cityId, detailsOpen: false, worldOpen: false, layersOpen: false });
}

// ── Shapes ───────────────────────────────────────────────────────────────────

type Ring = [number, number][];

function ringAreaDeg(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return Math.abs(a / 2);
}

/** Polyclip output as a shape, without the slivers clipping leaves (below `minDeg2`, degrees²). */
function toGeom(mp: Ring[][], minDeg2 = 2e-9): RegionGeom | null {
  const polys = mp.filter((p) => p.length && ringAreaDeg(p[0]) > minDeg2).map((p) => p.filter((r, i) => i === 0 || ringAreaDeg(r) > minDeg2));
  if (!polys.length) return null;
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
}

const asGeom = (g: RegionGeom) => g.coordinates as Geom;

/** A closed ring from the points clicked on the map. */
export function ringGeom(points: LngLat[]): RegionGeom | null {
  if (points.length < 3) return null;
  // Through a union, so a ring that crosses itself still gives a proper shape.
  try {
    return toGeom(union([[[...points, points[0]]]] as Geom) as Ring[][]);
  } catch {
    return null;
  }
}

/**
 * `plan` with `shape` as a district. The new district takes its ground from those it covers,
 * and the people on it: they are cut back, and the ones entirely under it disappear.
 */
export function withDistrict(plan: CityPlan, shape: RegionGeom, props: Partial<District> = {}): { plan: CityPlan; id: string } {
  const districts: Record<string, District> = {};
  // The people living on the ground it takes come with it.
  let taken = 0;
  for (const d of Object.values(plan.districts)) {
    let rest: RegionGeom | null = d.geom;
    try {
      rest = toGeom(difference(asGeom(d.geom), asGeom(shape)) as Ring[][]);
    } catch {
      /* keep it whole */
    }
    if (!rest) {
      taken += d.pop ?? 0;
      continue;
    }
    const area = geomArea(rest);
    // Barely touched (a shared border): leave it exactly as it was.
    if (Math.abs(area - d.area) < d.area * 1e-4) districts[d.id] = d;
    else if (area > d.area * 0.002) {
      const pop = d.pop != null ? Math.round((d.pop * area) / d.area) : undefined;
      taken += (d.pop ?? 0) - (pop ?? 0);
      districts[d.id] = { ...d, geom: rest, area, pop };
    } else taken += d.pop ?? 0;
  }
  const pop = props.pop || taken;
  const id = newId();
  const n = Object.keys(plan.districts).length;
  districts[id] = {
    id,
    name: props.name ?? `${plan.unit ?? 'District'} ${n + 1}`,
    color: props.color ?? freeColor(DISTRICT_COLORS, Object.values(plan.districts).map((d) => d.color)),
    geom: shape,
    area: geomArea(shape),
    ...(props.num != null ? { num: props.num } : {}),
    ...(pop ? { pop } : {}),
    ...(props.notes ? { notes: props.notes } : {}),
    ...(props.src ? { src: props.src } : {}),
  };
  return { plan: { ...plan, districts }, id };
}

function freeColor(palette: string[], used: string[]): string {
  const count = (c: string) => used.filter((u) => u.toUpperCase() === c).length;
  return palette.reduce((best, c) => (count(c) < count(best) ? c : best), palette[0]);
}

export function addDistrict(cityId: number, shape: RegionGeom, props: Partial<District> = {}): string | null {
  if (geomArea(shape) <= 0) return null;
  const { plan, id } = withDistrict(planOf(cityId), shape, props);
  put(cityId, `Add ${plan.districts[id].name}`, plan);
  return id;
}

export function updateDistrict(cityId: number, id: string, changes: Partial<District>, label = 'Edit district') {
  const plan = planOf(cityId);
  const d = plan.districts[id];
  if (!d) return;
  put(cityId, label, { ...plan, districts: { ...plan.districts, [id]: { ...d, ...changes } } }, `district:${cityId}:${id}:${Object.keys(changes).join(',')}`);
}

export function deleteDistrict(cityId: number, id: string) {
  const plan = planOf(cityId);
  const d = plan.districts[id];
  if (!d) return;
  const districts = { ...plan.districts };
  delete districts[id];
  put(cityId, `Remove ${d.name}`, { ...plan, districts });
}

/** Fuses districts into the first one (its name, number and colour; populations add up). */
export function mergeDistricts(cityId: number, ids: string[]): string | null {
  const plan = planOf(cityId);
  const ds = ids.map((id) => plan.districts[id]).filter(Boolean);
  if (ds.length < 2) return null;
  let geom: RegionGeom | null = null;
  try {
    geom = toGeom(union(asGeom(ds[0].geom), ...ds.slice(1).map((d) => asGeom(d.geom))) as Ring[][]);
  } catch {
    /* handled below */
  }
  if (!geom) {
    toast('These districts could not be merged', 'error');
    return null;
  }
  const districts = { ...plan.districts };
  for (const d of ds.slice(1)) delete districts[d.id];
  const pop = ds.reduce((t, d) => t + (d.pop ?? 0), 0);
  districts[ds[0].id] = { ...ds[0], geom, area: geomArea(geom), pop: pop || undefined };
  put(cityId, `Merge into ${ds[0].name}`, { ...plan, districts });
  return ds[0].id;
}

/** Numbers every district 1, 2, 3… from the centre of the city outwards. */
export function numberDistricts(cityId: number) {
  const plan = planOf(cityId);
  const city = useWorld.getState().doc?.cities[cityId];
  if (!city) return;
  const centre: LngLat = [city.lng, city.lat];
  const sorted = Object.values(plan.districts)
    .map((d) => ({ d, km: pointInGeom(centre, d.geom) ? 0 : distanceKm(centre, labelPoint(d.geom) ?? centre) }))
    .sort((a, b) => a.km - b.km);
  const districts: Record<string, District> = {};
  sorted.forEach(({ d }, i) => (districts[d.id] = { ...d, num: i + 1 }));
  put(cityId, 'Number the districts', { ...plan, districts });
}

export function setUnit(cityId: number, unit: string) {
  const plan = planOf(cityId);
  put(cityId, 'Rename the districts', { ...plan, unit: unit.trim() || undefined }, `unit:${cityId}`);
}

export const districtsPop = (plan: CityPlan) => Object.values(plan.districts).reduce((t, d) => t + (d.pop ?? 0), 0);
export const districtsArea = (plan: CityPlan) => Object.values(plan.districts).reduce((t, d) => t + d.area, 0);

/** "7 · Bassins à flot", or just the name. */
export const districtTitle = (d: District) => (d.num != null ? `${d.num} · ${d.name}` : d.name);

/** By number, then the unnumbered ones by name. */
export function sortedDistricts(plan: CityPlan): District[] {
  return Object.values(plan.districts).sort((a, b) => (a.num ?? Infinity) - (b.num ?? Infinity) || a.name.localeCompare(b.name));
}

/**
 * Shares `total` people among the districts, in the proportions they already have. A district
 * without a figure counts for its area, at the density of those that have one (so by area alone
 * when none has). The shares add up to `total` exactly.
 */
export function sharePopulation(cityId: number, total: number) {
  const plan = planOf(cityId);
  const ds = Object.values(plan.districts);
  if (!ds.length || !(total > 0)) return;
  const counted = ds.filter((d) => d.pop);
  const density = counted.length ? districtsPop(plan) / counted.reduce((t, d) => t + d.area, 0) : 1;
  const weight = (d: District) => d.pop || d.area * density;
  const sum = ds.reduce((t, d) => t + weight(d), 0) || 1;
  const districts: Record<string, District> = {};
  let given = 0;
  ds.forEach((d) => {
    const pop = Math.floor((total * weight(d)) / sum);
    given += pop;
    districts[d.id] = { ...d, pop };
  });
  // The people lost to rounding go to the biggest district.
  const top = ds.reduce((a, b) => (weight(b) > weight(a) ? b : a));
  districts[top.id] = { ...districts[top.id], pop: (districts[top.id].pop ?? 0) + (total - given) };
  put(cityId, 'Share the population among the districts', { ...plan, districts });
}

// ── Transit ──────────────────────────────────────────────────────────────────

export function addLine(cityId: number, mode: TransitMode = 'metro'): string {
  const plan = planOf(cityId);
  const lines = Object.values(plan.lines);
  const id = newId();
  let n = lines.filter((l) => l.mode === mode).length + 1;
  const names = new Set(lines.map((l) => l.name));
  while (names.has(MODES[mode].prefix + n)) n++;
  const line: TransitLine = { id, name: MODES[mode].prefix + n, color: freeColor(LINE_COLORS, lines.map((l) => l.color)), mode, stops: [] };
  put(cityId, `New line ${line.name}`, { ...plan, lines: { ...plan.lines, [id]: line } });
  return id;
}

export function updateLine(cityId: number, id: string, changes: Partial<TransitLine>, label = 'Edit line') {
  const plan = planOf(cityId);
  const l = plan.lines[id];
  if (!l) return;
  put(cityId, label, { ...plan, lines: { ...plan.lines, [id]: { ...l, ...changes } } }, `line:${cityId}:${id}:${Object.keys(changes).join(',')}`);
}

/** Drops the stations no line calls at any more. */
function prune(plan: CityPlan): CityPlan {
  const used = new Set(Object.values(plan.lines).flatMap((l) => l.stops));
  if (Object.keys(plan.stations).every((id) => used.has(id))) return plan;
  return { ...plan, stations: Object.fromEntries(Object.entries(plan.stations).filter(([id]) => used.has(id))) };
}

export function deleteLine(cityId: number, id: string) {
  const plan = planOf(cityId);
  const l = plan.lines[id];
  if (!l) return;
  const lines = { ...plan.lines };
  delete lines[id];
  put(cityId, `Remove line ${l.name}`, prune({ ...plan, lines }));
}

/** Where a stop at `at` joins the line: before its first stop when that end is the nearer one, else after its last. */
export function nearerEnd(plan: CityPlan, line: TransitLine, at: LngLat): number {
  if (line.stops.length < 2) return line.stops.length;
  const first = plan.stations[line.stops[0]];
  const last = plan.stations[line.stops[line.stops.length - 1]];
  if (!first || !last) return line.stops.length;
  return distanceKm(at, [first.lng, first.lat]) < distanceKm(at, [last.lng, last.lat]) ? 0 : line.stops.length;
}

/**
 * Adds a stop to a line: a new station at `at` (a point), or an existing station (its id) — which
 * makes it an interchange. `index` puts it between two stops; otherwise it extends the nearer end.
 * Returns the station's id.
 */
export function addStop(cityId: number, lineId: string, at: LngLat | string, opts: { index?: number; name?: string } = {}): string | null {
  const plan = planOf(cityId);
  const line = plan.lines[lineId];
  if (!line) return null;
  let stations = plan.stations;
  let sid: string;
  if (typeof at === 'string') {
    if (!stations[at] || line.stops.includes(at)) return null;
    sid = at;
  } else {
    sid = newId();
    const taken = new Set(Object.values(stations).map((s) => s.name));
    let name = opts.name?.trim() || '';
    if (!name || taken.has(name)) {
      let n = Object.keys(stations).length + 1;
      while (taken.has(`Station ${n}`)) n++;
      name = name ? `${name} ${n}` : `Station ${n}`;
    }
    stations = { ...stations, [sid]: { id: sid, name, lng: +at[0].toFixed(6), lat: +at[1].toFixed(6) } };
  }
  const s = stations[sid];
  const index = opts.index ?? nearerEnd(plan, line, [s.lng, s.lat]);
  const stops = [...line.stops.slice(0, index), sid, ...line.stops.slice(index)];
  put(cityId, `Add ${s.name} to ${line.name}`, { ...plan, stations, lines: { ...plan.lines, [lineId]: { ...line, stops } } });
  return sid;
}

export function updateStation(cityId: number, id: string, changes: Partial<Station>, label = 'Edit station', group = `station:${cityId}:${id}:${Object.keys(changes).join(',')}`) {
  const plan = planOf(cityId);
  const s = plan.stations[id];
  if (!s) return;
  put(cityId, label, { ...plan, stations: { ...plan.stations, [id]: { ...s, ...changes } } }, group);
}

/** Takes a station off one line (it disappears with its last line). */
export function removeStop(cityId: number, lineId: string, sid: string) {
  const plan = planOf(cityId);
  const line = plan.lines[lineId];
  const s = plan.stations[sid];
  if (!line || !s) return;
  put(cityId, `Remove ${s.name} from ${line.name}`, prune({ ...plan, lines: { ...plan.lines, [lineId]: { ...line, stops: line.stops.filter((x) => x !== sid) } } }));
}

/** Removes a station from every line. */
export function deleteStation(cityId: number, sid: string) {
  const plan = planOf(cityId);
  const s = plan.stations[sid];
  if (!s) return;
  const lines = Object.fromEntries(Object.entries(plan.lines).map(([id, l]) => [id, l.stops.includes(sid) ? { ...l, stops: l.stops.filter((x) => x !== sid) } : l]));
  put(cityId, `Remove ${s.name}`, prune({ ...plan, lines }));
}

export const linesAt = (plan: CityPlan, sid: string): TransitLine[] => Object.values(plan.lines).filter((l) => l.stops.includes(sid));

export function lineKm(plan: CityPlan, line: TransitLine): number {
  let km = 0;
  for (let i = 1; i < line.stops.length; i++) {
    const a = plan.stations[line.stops[i - 1]];
    const b = plan.stations[line.stops[i]];
    if (a && b) km += distanceKm([a.lng, a.lat], [b.lng, b.lat]);
  }
  return km;
}

export function networkStats(plan: CityPlan) {
  const lines = Object.values(plan.lines);
  return { lines: lines.length, stations: Object.keys(plan.stations).length, km: lines.reduce((t, l) => t + lineKm(plan, l), 0) };
}

/** The district a point lies in. */
export function districtAt(plan: CityPlan, at: LngLat): District | null {
  return Object.values(plan.districts).find((d) => pointInGeom(at, d.geom)) ?? null;
}

const WIDTH: Record<TransitMode, number> = { metro: 5, train: 5, tram: 3.5, bus: 2.5 };

/**
 * The network as map features. Each stretch between two stops is its own feature; where several
 * lines run between the same two stations they are drawn side by side (`offset`, in line widths)
 * instead of on top of one another.
 */
export function transitFeatures(plan: CityPlan): { lines: FeatureCollection<LineString>; stations: FeatureCollection<Point> } {
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const shared = new Map<string, string[]>();
  for (const l of Object.values(plan.lines))
    for (let i = 1; i < l.stops.length; i++) {
      const k = key(l.stops[i - 1], l.stops[i]);
      const on = shared.get(k) ?? [];
      if (!on.includes(l.id)) on.push(l.id);
      shared.set(k, on);
    }
  const lines: Feature<LineString>[] = [];
  for (const l of Object.values(plan.lines))
    for (let i = 1; i < l.stops.length; i++) {
      const [x, y] = [l.stops[i - 1], l.stops[i]];
      // Always drawn the same way round, so "left of the line" means the same for every line on it.
      const [a, b] = x < y ? [plan.stations[x], plan.stations[y]] : [plan.stations[y], plan.stations[x]];
      if (!a || !b) continue;
      const on = shared.get(key(x, y))!;
      lines.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [b.lng, b.lat]] },
        properties: { line: l.id, color: l.color, width: WIDTH[l.mode], dashed: l.mode === 'bus', offset: on.indexOf(l.id) - (on.length - 1) / 2, after: i - 1 },
      });
    }
  const stations: Feature<Point>[] = Object.values(plan.stations).map((s) => {
    const on = linesAt(plan, s.id);
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: { id: s.id, name: s.name, hub: on.length > 1, color: on[0]?.color ?? '#333333', end: on.some((l) => l.stops[0] === s.id || l.stops[l.stops.length - 1] === s.id) },
    };
  });
  return { lines: { type: 'FeatureCollection', features: lines }, stations: { type: 'FeatureCollection', features: stations } };
}
