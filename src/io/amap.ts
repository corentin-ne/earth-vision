// Import / export of "A+ World Map Editor" .map files.
//
// A .map is a regular zip archive whose very first 4 bytes ("PK\x03\x04") are
// replaced by the signature "A+WM". Inside:
//   country_simple.json   countries (merged geometry + metadata)
//   region_simple.json    regions, each with the owning country id `cid`
//   city.json             cities (t: 0 = city, 1 = capital of `c`)
//   water.json            water labels
//   flag/<CID>.png        custom flags
//   theme.json            palette; a country colour may be an index into it
//   country_info_type.json / country_extra_info_type.json   stat & text field names
//   …plus settings, landmarks, alliances, etc. which are kept as-is.
//
// Earth Vision adds one file A+ ignores, earth_vision.json, holding what the A+
// format cannot express (notes, per-region populations, city sizes, all stats &
// fields, the camera), so a .map round trip loses nothing.
import { unzipSync, zipSync, strFromU8, strToU8, type Zippable } from 'fflate';
import type { Feature, FeatureCollection, Point } from 'geojson';
import type { City, Country, Region, RegionGeom, WaterLabel, WorldBundle, WorldDoc, StatDef, Alliance } from '../types';
import { geomArea, labelPoint, GeoEngine } from '../geo/engine';
import { distributeByArea } from '../world/stats';
import { uid } from '../util';

const SIG_AMAP = [0x41, 0x2b, 0x57, 0x4d]; // "A+WM"
const SIG_ZIP = [0x50, 0x4b, 0x03, 0x04]; // "PK\3\4"

const DEFAULT_THEME = ['#D6C7FF', '#EBCA8A', '#C1E599', '#E7E58F', '#98DDA1', '#83D5F4', '#B1BBF9', '#FFFFFF', '#EAB38F'];

interface AmapCountryProps {
  area: number;
  cid: string;
  color: string;
  cx: number;
  cy: number;
  extra: string[];
  info: number[];
  label_angle: number;
  label_spacing: number;
  name: string;
  size_factor: number;
}

interface InfoType {
  name: string;
  use: boolean;
  update: boolean;
}

const json = <T>(files: Record<string, Uint8Array>, name: string, fallback: T): T => {
  const f = files[name];
  if (!f) return fallback;
  try {
    return JSON.parse(strFromU8(f)) as T;
  } catch {
    return fallback;
  }
};

export function isAmap(bytes: Uint8Array): boolean {
  return SIG_AMAP.every((b, i) => bytes[i] === b);
}

export function unzipAmap(bytes: Uint8Array): Record<string, Uint8Array> {
  const copy = bytes.slice();
  if (isAmap(copy)) SIG_ZIP.forEach((b, i) => (copy[i] = b));
  return unzipSync(copy);
}

/** Files we rebuild on export; everything else is carried through untouched. */
const SIDECAR = 'earth_vision.json';

interface Sidecar {
  format: 'earth-vision';
  version: 1;
  created?: number;
  stats?: StatDef[];
  fields?: string[];
  palette?: string[];
  view?: WorldDoc['view'];
  countries?: Record<string, { notes?: string; stats?: Record<string, number>; fields?: Record<string, string> }>;
  /** Region id → [owner, scaling values]; the owner tells whether A+ moved the region since. */
  regions?: Record<number, [string, Record<string, number>]>;
  cities?: Record<number, { pop?: number }>;
}

const OWNED = new Set([SIDECAR, 'country_simple.json', 'region_simple.json', 'city.json', 'water.json', 'map_info.json', 'alliance/alliances.json']);

export function importAmap(bytes: Uint8Array, fileName = 'World'): WorldBundle {
  const files = unzipAmap(bytes);
  const info = json<{ title?: string; id?: string }>(files, 'map_info.json', {});
  const theme = json<string[]>(files, 'theme.json', DEFAULT_THEME);
  const infoTypes = json<InfoType[]>(files, 'country_info_type.json', [{ name: 'Population', use: true, update: true }]);
  const extraTypes = json<string[]>(files, 'country_extra_info_type.json', []);
  const settingsFile = json<Record<string, unknown>>(files, 'settings.json', {});

  const stats: StatDef[] = infoTypes.filter((t) => t.use && t.name).map((t) => ({ key: t.name, scale: t.update }));
  const fields = extraTypes.filter(Boolean);

  const resolveColor = (c: string): string => {
    if (/^\d+$/.test(c)) return (theme[+c] ?? DEFAULT_THEME[+c % DEFAULT_THEME.length]).toUpperCase();
    return c.startsWith('#') ? c.toUpperCase() : '#CCCCCC';
  };

  // Flags
  const flags: Record<string, Blob> = {};
  for (const [path, data] of Object.entries(files)) {
    const m = /^flag\/([^/]+)\.png$/i.exec(path);
    if (m && data.length) flags[m[1]] = new Blob([data as BlobPart], { type: 'image/png' });
  }

  // Countries
  const countries: Record<string, Country> = {};
  const scaleTotals: Record<string, Record<string, number>> = {};
  const cfc = json<FeatureCollection>(files, 'country_simple.json', { type: 'FeatureCollection', features: [] });
  for (const f of cfc.features) {
    const p = f.properties as AmapCountryProps;
    const c: Country = {
      cid: p.cid,
      name: p.name,
      color: resolveColor(String(p.color)),
      stats: {},
      fields: {},
      label: [p.cx, p.cy],
    };
    infoTypes.forEach((t, i) => {
      if (!t.use || !t.name) return;
      const v = Number(p.info?.[i] ?? 0);
      if (t.update) (scaleTotals[p.cid] ??= {})[t.name] = v;
      else c.stats[t.name] = v;
    });
    extraTypes.forEach((name, i) => {
      if (name && p.extra?.[i]) c.fields[name] = p.extra[i];
    });
    if (flags[p.cid]) c.flag = p.cid;
    countries[p.cid] = c;
  }

  // Regions
  const regions: Record<number, Region> = {};
  const geoms: Record<number, RegionGeom> = {};
  const rfc = json<FeatureCollection>(files, 'region_simple.json', { type: 'FeatureCollection', features: [] });
  let nextId = 0;
  for (const f of rfc.features) {
    const g = f.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue; // degenerate
    const p = f.properties as { area?: number; cid: string; cx?: number; cy?: number; name: string };
    const id = typeof f.id === 'number' ? f.id : nextId;
    nextId = Math.max(nextId, id + 1);
    const lp = p.cx != null && p.cy != null ? [p.cx, p.cy] : labelPoint(g);
    regions[id] = {
      id,
      name: p.name,
      cid: p.cid ?? '',
      area: p.area || geomArea(g),
      cx: lp?.[0] ?? 0,
      cy: lp?.[1] ?? 0,
    };
    geoms[id] = g;
    if (p.cid && !countries[p.cid]) {
      countries[p.cid] = { cid: p.cid, name: p.cid, color: '#CCCCCC', stats: {}, fields: {} };
    }
  }
  distributeByArea(regions, scaleTotals);
  const side = json<Sidecar | null>(files, SIDECAR, null);
  if (side?.format === 'earth-vision') applySidecar(side, countries, regions, scaleTotals);

  // Cities
  const cities: Record<number, City> = {};
  const cityFc = json<FeatureCollection<Point>>(files, 'city.json', { type: 'FeatureCollection', features: [] });
  cityFc.features.forEach((f, i) => {
    const p = f.properties as { label: string; t?: number; c?: string; hide?: boolean };
    const id = typeof f.id === 'number' ? f.id : i;
    const [lng, lat] = f.geometry.coordinates;
    cities[id] = { id, name: p.label, lng, lat, capital: p.t === 1, hidden: p.hide || undefined };
    const pop = side?.cities?.[id]?.pop;
    if (pop) cities[id].pop = pop;
    if (p.t === 1 && p.c && countries[p.c] && countries[p.c].capital == null) countries[p.c].capital = id;
  });

  // Water labels
  const water: WaterLabel[] = json<FeatureCollection<Point>>(files, 'water.json', { type: 'FeatureCollection', features: [] }).features.map(
    (f, i) => ({
      id: i,
      name: String((f.properties as { label: string }).label ?? ''),
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }),
  );

  // Alliances
  const al = json<{ alliances?: { id: string; name: string; color: string; members: string[] }[] }>(files, 'alliance/alliances.json', {});
  const alliances: Alliance[] = (al.alliances ?? []).map((a) => ({ id: a.id, name: a.name, color: a.color, members: a.members ?? [] }));

  const passthrough: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(files)) {
    if (OWNED.has(path) || path.endsWith('/') || path.startsWith('flag/') || path.startsWith('flag.bak/')) continue;
    passthrough[path] = data;
  }
  if (files['alliance/alliances.json']) passthrough['alliance/alliances.json'] = files['alliance/alliances.json'];

  const now = Date.now();
  const lastX = Number(settingsFile.last_x);
  const lastY = Number(settingsFile.last_y);
  const doc: WorldDoc = {
    meta: {
      id: uid(),
      title: info.title || fileName.replace(/\.map.*$/i, ''),
      created: side?.created ?? now,
      modified: now,
      source: 'amap',
    },
    settings: {
      stats: side?.stats ?? stats,
      fields: side?.fields ?? fields,
      palette: side?.palette ?? theme.map((c) => c.toUpperCase()),
    },
    countries,
    regions,
    cities,
    water,
    alliances,
    view: side?.view ?? (Number.isFinite(lastX) && Number.isFinite(lastY) ? { center: [lastX, lastY], zoom: Math.max(1.5, Number(settingsFile.last_zoom) || 2) } : undefined),
  };
  return { doc, geoms, flags, passthrough };
}

async function toPng(blob: Blob): Promise<Uint8Array> {
  if (blob.type === 'image/png') return new Uint8Array(await blob.arrayBuffer());
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  const png = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await png.arrayBuffer());
}

export async function exportAmap(bundle: WorldBundle): Promise<Uint8Array> {
  const { doc, geoms, flags } = bundle;
  const pass = bundle.passthrough ?? {};
  const infoTypes: InfoType[] = pass['country_info_type.json']
    ? JSON.parse(strFromU8(pass['country_info_type.json']))
    : padInfoTypes(doc.settings.stats);
  const extraTypes: string[] = pass['country_extra_info_type.json']
    ? JSON.parse(strFromU8(pass['country_extra_info_type.json']))
    : padExtra(doc.settings.fields);

  const engine = new GeoEngine();
  engine.build(geoms);

  const byCountry: Record<string, number[]> = {};
  const scaled: Record<string, Record<string, number>> = {};
  for (const r of Object.values(doc.regions)) {
    if (!r.cid) continue;
    (byCountry[r.cid] ??= []).push(r.id);
    for (const [k, v] of Object.entries(r.vals ?? {})) {
      const s = (scaled[r.cid] ??= {});
      s[k] = (s[k] ?? 0) + v;
    }
  }

  const countryFeatures: Feature[] = [];
  for (const c of Object.values(doc.countries)) {
    const ids = byCountry[c.cid];
    if (!ids?.length) continue;
    const geometry = engine.merge(ids);
    if (!geometry) continue;
    const area = ids.reduce((s, id) => s + (doc.regions[id]?.area ?? 0), 0);
    const lp = c.label ?? labelPoint(geometry) ?? [0, 0];
    countryFeatures.push({
      type: 'Feature',
      id: countryFeatures.length,
      geometry: geometry.coordinates.length === 1 ? { type: 'Polygon', coordinates: geometry.coordinates[0] } : geometry,
      properties: {
        area: +area.toFixed(2),
        cid: c.cid,
        color: c.color,
        cx: lp[0],
        cy: lp[1],
        extra: extraTypes.map((name) => (name ? c.fields[name] ?? '' : '')),
        info: infoTypes.map((t) => (t.name ? Math.round(t.update ? scaled[c.cid]?.[t.name] ?? 0 : c.stats[t.name] ?? 0) : 0)),
        label_angle: 0,
        label_spacing: 0,
        name: c.name,
        size_factor: 1,
      } satisfies AmapCountryProps,
    });
  }

  const regionFeatures: Feature[] = Object.values(doc.regions)
    .filter((r) => geoms[r.id])
    .map((r) => ({
      type: 'Feature',
      id: r.id,
      geometry: geoms[r.id],
      properties: { area: +r.area.toFixed(2), cid: r.cid, cx: r.cx, cy: r.cy, name: r.name },
    }));

  const capitalOf: Record<number, string> = {};
  for (const c of Object.values(doc.countries)) if (c.capital != null) capitalOf[c.capital] = c.cid;
  const cityFeatures: Feature[] = Object.values(doc.cities).map((c) => ({
    type: 'Feature',
    id: c.id,
    geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
    properties: { c: capitalOf[c.id] ?? '', label: c.name, t: c.capital ? 1 : 0, ...(c.hidden ? { hide: true } : {}) },
  }));
  const waterFeatures: Feature[] = doc.water.map((w) => ({
    type: 'Feature',
    id: w.id,
    geometry: { type: 'Point', coordinates: [w.lng, w.lat] },
    properties: { label: w.name },
    }));

  const prevInfo = pass['map_info.json'] ? JSON.parse(strFromU8(pass['map_info.json'])) : {};
  const fc = (features: Feature[]) => strToU8(JSON.stringify({ type: 'FeatureCollection', features }));

  // country_simple.json must come first: its local header carries the A+WM signature.
  const zip: Zippable = {
    'country_simple.json': fc(countryFeatures),
    'region_simple.json': fc(regionFeatures),
    'water.json': strToU8(JSON.stringify({ features: waterFeatures, type: 'FeatureCollection' })),
    'city.json': strToU8(JSON.stringify({ features: cityFeatures, type: 'FeatureCollection' })),
    'country_info_type.json': strToU8(JSON.stringify(infoTypes)),
    'country_extra_info_type.json': strToU8(JSON.stringify(extraTypes)),
    'map_info.json': strToU8(
      JSON.stringify({
        id: prevInfo.id ?? String(doc.meta.created),
        edition: prevInfo.edition ?? '',
        title: doc.meta.title,
        countries: countryFeatures.length,
        regions: regionFeatures.length,
        modified: Date.now(),
        express: prevInfo.express ?? 0,
      }),
    ),
  };
  if (!pass['theme.json']) zip['theme.json'] = strToU8(JSON.stringify(doc.settings.palette.slice(0, 9)));
  const usedFlags = new Set<string>();
  for (const c of Object.values(doc.countries)) {
    if (c.flag && flags[c.flag]) {
      zip[`flag/${c.cid}.png`] = await toPng(flags[c.flag]);
      usedFlags.add(c.flag);
    }
  }
  // Flags of countries that no longer exist are kept, as A+ does.
  for (const [key, blob] of Object.entries(flags)) {
    if (!usedFlags.has(key) && !key.includes('-') && !zip[`flag/${key}.png`]) zip[`flag/${key}.png`] = await toPng(blob);
  }
  const alliances = {
    version: 1,
    alliances: doc.alliances.map((a) => ({ id: a.id, name: a.name, color: a.color, members: a.members, created: Date.now(), modified: Date.now() })),
  };
  for (const [path, data] of Object.entries(pass)) {
    if (!(path in zip) && path !== 'alliance/alliances.json') zip[path] = data;
  }
  if (doc.alliances.length || pass['alliance/alliances.json']) {
    const prev = pass['alliance/alliances.json'] ? JSON.parse(strFromU8(pass['alliance/alliances.json'])) : null;
    const merged = prev
      ? { ...prev, alliances: alliances.alliances.map((a) => ({ ...(prev.alliances ?? []).find((p: { id: string }) => p.id === a.id), ...a })) }
      : alliances;
    zip['alliance/alliances.json'] = strToU8(JSON.stringify(merged, null, 2));
  }
  zip[SIDECAR] = strToU8(JSON.stringify(buildSidecar(doc)));
  zip['__signature__'] = pass['__signature__'] ?? strToU8('A+ World Map Editor');

  const out = zipSync(zip, { level: 6 });
  SIG_AMAP.forEach((b, i) => (out[i] = b));
  return out;
}

function buildSidecar(doc: WorldDoc): Sidecar {
  const countries: NonNullable<Sidecar['countries']> = {};
  for (const c of Object.values(doc.countries)) {
    if (c.notes || Object.keys(c.stats).length || Object.keys(c.fields).length) countries[c.cid] = { notes: c.notes, stats: c.stats, fields: c.fields };
  }
  const regions: NonNullable<Sidecar['regions']> = {};
  for (const r of Object.values(doc.regions)) if (r.vals && Object.keys(r.vals).length) regions[r.id] = [r.cid, r.vals];
  const cities: NonNullable<Sidecar['cities']> = {};
  for (const c of Object.values(doc.cities)) if (c.pop) cities[c.id] = { pop: c.pop };
  return {
    format: 'earth-vision',
    version: 1,
    created: doc.meta.created,
    stats: doc.settings.stats,
    fields: doc.settings.fields,
    palette: doc.settings.palette,
    view: doc.view,
    countries,
    regions,
    cities,
  };
}

/**
 * Restores what A+ cannot store. Region values are only trusted for a country when
 * they still add up to the total A+ saved for it — otherwise the map was edited in
 * A+ since, and the area-based split from that total is kept.
 */
function applySidecar(
  side: Sidecar,
  countries: Record<string, Country>,
  regions: Record<number, Region>,
  totals: Record<string, Record<string, number>>,
) {
  for (const [cid, extra] of Object.entries(side.countries ?? {})) {
    const c = countries[cid];
    if (!c) continue;
    if (extra.notes) c.notes = extra.notes;
    c.stats = { ...extra.stats, ...c.stats };
    c.fields = { ...extra.fields, ...c.fields };
  }
  const sums: Record<string, Record<string, number>> = {};
  for (const r of Object.values(regions)) {
    const saved = side.regions?.[r.id];
    if (!saved || saved[0] !== r.cid) continue;
    const s = (sums[r.cid] ??= {});
    for (const [k, v] of Object.entries(saved[1])) s[k] = (s[k] ?? 0) + v;
  }
  const matches = (cid: string) =>
    Object.entries(totals[cid] ?? {}).every(([k, t]) => Math.abs((sums[cid]?.[k] ?? 0) - t) <= Math.max(1, Math.abs(t) * 0.01));
  for (const r of Object.values(regions)) {
    const saved = side.regions?.[r.id];
    if (saved && saved[0] === r.cid && matches(r.cid)) r.vals = { ...saved[1] };
  }
}

function padInfoTypes(stats: StatDef[]): InfoType[] {
  const out: InfoType[] = stats.slice(0, 6).map((s) => ({ name: s.key, use: true, update: s.scale }));
  while (out.length < 6) out.push({ name: '', use: false, update: false });
  return out;
}

function padExtra(fields: string[]): string[] {
  const out = fields.slice(0, 10);
  while (out.length < 10) out.push('');
  return out;
}
