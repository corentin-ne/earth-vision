// Real administrative areas (towns, arrondissements, quarters…) around a city, from
// OpenStreetMap through the Overpass API. They are offered as shapes to turn into districts.
import type { Position } from 'geojson';
import type { RegionGeom } from '../types';
import { geomArea, labelPoint, pointInGeom } from '../geo/engine';

/** An area that can become a district. */
export interface Candidate {
  id: string;
  name: string;
  /** OSM admin_level: the higher, the smaller the areas (8 = towns, 9–10 = their parts, in most countries). */
  level: number;
  pop?: number;
  geom: RegionGeom;
  /** km² */
  area: number;
}

interface OsmWay {
  type: string;
  role?: string;
  geometry?: { lat: number; lon: number }[];
}
interface OsmRelation {
  type: string;
  id: number;
  tags?: Record<string, string>;
  members?: OsmWay[];
}

/** Whole-planet servers only: a regional one would answer "nothing here" for the rest of the world. */
const SERVERS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** Bigger than any city district: counties and departments that merely overlap the view. */
const MAX_KM2 = 2600;

/** Douglas–Peucker; `tol` in degrees. End points are kept, so ways still join after it. */
export function simplify(pts: Position[], tol: number): Position[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const dx = pts[b][0] - ax;
    const dy = pts[b][1] - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let max = tol * tol;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] - ax;
      const py = pts[i][1] - ay;
      const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const d2 = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      if (d2 > max) {
        max = d2;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const key = (p: Position) => `${p[0]},${p[1]}`;

/** Joins pieces of outline end to end into closed rings (pieces that never close are dropped). */
export function joinRings(ways: Position[][]): Position[][] {
  const rings: Position[][] = [];
  const open = ways.filter((w) => w.length > 1).map((w) => [...w]);
  while (open.length) {
    let cur = open.pop()!;
    for (;;) {
      if (cur.length > 3 && key(cur[0]) === key(cur[cur.length - 1])) {
        rings.push(cur);
        break;
      }
      const end = key(cur[cur.length - 1]);
      const i = open.findIndex((w) => key(w[0]) === end || key(w[w.length - 1]) === end);
      if (i < 0) break;
      const [next] = open.splice(i, 1);
      if (key(next[0]) !== end) next.reverse();
      cur = cur.concat(next.slice(1));
    }
  }
  return rings;
}

function inRing([x, y]: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The shape of an OSM boundary relation. Its ways are simplified one by one before they are
 * joined: a way shared by two neighbours gives both the very same border, with no gap between.
 */
export function relationGeom(rel: OsmRelation, tol = 2.5e-5): RegionGeom | null {
  const part = (role: string) =>
    joinRings(
      (rel.members ?? [])
        .filter((m) => m.type === 'way' && m.geometry?.length && (m.role || 'outer') === role)
        .map((m) => simplify(m.geometry!.map((p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)]), tol)),
    );
  const outers = part('outer');
  if (!outers.length) return null;
  const inners = part('inner');
  const polys = outers.map((o) => [o, ...inners.filter((h) => inRing(h[0], o))]);
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
}

export function parseOverpass(json: { elements?: OsmRelation[] }): Candidate[] {
  const out: Candidate[] = [];
  for (const rel of json.elements ?? []) {
    if (rel.type !== 'relation' || !rel.tags) continue;
    const level = Number(rel.tags.admin_level);
    const name = rel.tags.name;
    if (!name || !Number.isFinite(level)) continue;
    const geom = relationGeom(rel);
    if (!geom) continue;
    const area = geomArea(geom);
    if (area <= 0 || area > MAX_KM2) continue;
    const pop = Number(rel.tags.population);
    out.push({ id: `r${rel.id}`, name, level, geom, area, ...(pop > 0 ? { pop } : {}) });
  }
  return out.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

/** Shown as "the most detailed everywhere": see `shownAreas`. */
export const FINEST = 0;

/**
 * The areas of one size (`level`), or with FINEST the smallest known everywhere: a town's
 * quarters where it has some, the whole town where it has none.
 */
export function shownAreas(areas: Candidate[], level: number | null): Candidate[] {
  if (level !== FINEST) return areas.filter((a) => a.level === level);
  const centres = areas.map((a) => labelPoint(a.geom));
  return areas.filter((a) => !areas.some((b, i) => b.level > a.level && centres[i] && pointInGeom(centres[i]!, a.geom)));
}

/** The sizes on offer, each named after one of its areas (the nearest to `centre` not yet used as an example). */
export function areaLevels(areas: Candidate[], centre: [number, number]): { level: number; count: number; example: string }[] {
  const finest = new Set(shownAreas(areas, FINEST).map((a) => a.id));
  const d2 = (a: Candidate) => {
    const p = labelPoint(a.geom) ?? centre;
    // An area that is not cut any finer tells its size best.
    return (p[0] - centre[0]) ** 2 + (p[1] - centre[1]) ** 2 + (finest.has(a.id) ? 0 : 1);
  };
  const used = new Set<string>();
  const out: { level: number; count: number; example: string }[] = [];
  for (const level of [...new Set(areas.map((a) => a.level))].sort((a, b) => a - b)) {
    const of = areas.filter((a) => a.level === level);
    // A single area is what the others are parts of, not a way to cut the city.
    if (of.length < 2) continue;
    const pool = of.filter((a) => !used.has(a.name));
    const ex = (pool.length ? pool : of).reduce((a, b) => (d2(b) < d2(a) ? b : a));
    used.add(ex.name);
    out.push({ level, count: of.length, example: ex.name });
  }
  return out;
}

/** The server that answered last is asked first next time. */
let preferred = 0;

/**
 * Runs an Overpass query. The public servers are often busy or silent: the first one is asked,
 * and each time 4 seconds pass without an answer (or one fails) the next joins in. The first
 * proper answer wins and the others are dropped.
 */
function overpass<T extends { elements?: unknown[]; remark?: string }>(query: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const running: AbortController[] = [];
    let started = 0;
    let failed = 0;
    let done = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    const end = () => {
      done = true;
      clearTimeout(next);
      running.forEach((c) => c.abort());
      signal?.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      if (done) return;
      end();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const start = () => {
      clearTimeout(next);
      if (done || started >= SERVERS.length) return;
      const at = (preferred + started++) % SERVERS.length;
      const c = new AbortController();
      running.push(c);
      const kill = setTimeout(() => c.abort(), 45_000);
      fetch(SERVERS[at], { method: 'POST', body: new URLSearchParams({ data: query }), signal: c.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`${res.status}`);
          const json = (await res.json()) as T;
          // A query cut short by the server still answers, with what it had and a remark.
          if (!Array.isArray(json.elements) || /error|timed out/i.test(json.remark ?? '')) throw new Error(json.remark || 'Bad answer');
          if (done) return;
          preferred = at;
          end();
          resolve(json);
        })
        .catch((err) => {
          failed++;
          if (done) return;
          if (failed === SERVERS.length) {
            end();
            reject(err);
          } else if (failed === started) start();
        })
        .finally(() => clearTimeout(kill));
      next = setTimeout(start, 4000);
    };
    if (signal?.aborted) return cancel();
    signal?.addEventListener('abort', cancel);
    start();
  });
}

const ADMIN = '["boundary"="administrative"]';
/** Outlines longer than 300 km are counties and departments: their heavy shapes are not even sent. */
const SMALL = '(if:length()<300000)';

/** The administrative areas (levels 6–10) touching the box [west, south, east, north]. */
export async function fetchAreas(box: [number, number, number, number], signal?: AbortSignal): Promise<Candidate[]> {
  const [w, s, e, n] = box.map((v) => v.toFixed(5));
  return parseOverpass(await overpass(`[out:json][timeout:40];relation${ADMIN}["admin_level"~"^(6|7|8|9|10)$"](${s},${w},${n},${e})${SMALL};out geom;`, signal));
}

/**
 * The town a point lies in, among the areas that contain it: the smallest one that is a town or
 * bigger (level 8 at most), so not one of its own quarters.
 */
export function townOf(elements: OsmRelation[]): { id: number; level: number } | null {
  let best: { id: number; level: number } | null = null;
  for (const e of elements) {
    const level = Number(e.tags?.admin_level);
    if (e.type !== 'relation' || !(level >= 4 && level <= 8)) continue;
    if (!best || level > best.level) best = { id: e.id, level };
  }
  return best;
}

/** The query for a town, its quarters (every finer level inside it) and the towns that touch it. */
export function townQuery(town: { id: number; level: number }): string {
  const finer = Array.from({ length: 10 - town.level }, (_, i) => town.level + 1 + i).join('|');
  return (
    `[out:json][timeout:40];rel(${town.id})->.t;way(r.t)->.w;` +
    // Sharing a stretch of outline with the town is what makes a neighbour.
    `rel(bw.w)${ADMIN}["admin_level"="${town.level}"]${SMALL}->.nb;` +
    (finer ? `.t map_to_area->.a;rel(area.a)${ADMIN}["admin_level"~"^(${finer})$"]->.q;(.nb;.q;);` : '.nb;') +
    'out geom;'
  );
}

/**
 * Just what a city is made of and what it can grow into: the town at [lng, lat], its quarters
 * and the towns right next to it. Two light requests instead of everything in a box.
 */
export async function fetchTown(at: [number, number], signal?: AbortSignal): Promise<Candidate[]> {
  const [lng, lat] = at.map((v) => v.toFixed(5));
  const around = await overpass<{ elements?: OsmRelation[] }>(`[out:json][timeout:25];is_in(${lat},${lng});rel(pivot)${ADMIN};out tags;`, signal);
  const town = townOf(around.elements ?? []);
  // Nowhere known (open sea, an unmapped place): whatever lies within a few kilometres.
  if (!town) return fetchAreas([at[0] - 0.08, at[1] - 0.06, at[0] + 0.08, at[1] + 0.06], signal);
  return parseOverpass(await overpass(townQuery(town), signal));
}
