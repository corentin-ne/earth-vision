// Extra data layers from free, open sources (Natural Earth, USGS, NASA…), fetched the first
// time they are turned on and kept in the browser's cache so they work offline afterwards.
// Live feeds (earthquakes, natural events) refresh when online and fall back to the cache.
import type { FeatureCollection } from 'geojson';
import type { LayerSpecification, Map as MLMap } from 'maplibre-gl';

export interface Overlay {
  id: string;
  name: string;
  desc: string;
  credit: string;
  url: string;
  kind: 'fill' | 'line' | 'point';
  color: string;
  /** Refreshed from the network each session. */
  live?: boolean;
  /** Feature property shown as a label / in the hover tip. */
  label?: string;
  /** Approximate download size. */
  size: string;
  /** Trims each feature's properties (and drops features) to keep memory low. */
  prep?: (fc: FeatureCollection) => FeatureCollection;
  layers?: (id: string, o: Overlay) => LayerSpecification[];
}

const NE = (f: string) => `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/${f}.geojson`;
const keep = (...keys: string[]) => (fc: FeatureCollection): FeatureCollection => ({
  type: 'FeatureCollection',
  features: fc.features.map((f) => ({ ...f, properties: Object.fromEntries(keys.map((k) => [k, f.properties?.[k] ?? null])) })),
});

export const OVERLAYS: Overlay[] = [
  {
    id: 'reefs',
    name: 'Coral reefs',
    desc: 'The world’s major coral reefs',
    credit: 'Natural Earth',
    url: NE('ne_10m_reefs'),
    kind: 'line',
    color: '#ff6f91',
    size: '0.5 MB',
    prep: keep('featurecla'),
    layers: (id, o) => [
      { id: `${id}-glow`, type: 'line', source: id, paint: { 'line-color': o.color, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 2, 6, 6], 'line-opacity': 0.35, 'line-blur': 2 } },
      { id, type: 'line', source: id, paint: { 'line-color': o.color, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.8, 6, 2], 'line-dasharray': [1, 1] } },
    ],
  },
  {
    id: 'glaciers',
    name: 'Glaciers & ice caps',
    desc: 'Glaciated areas on land',
    credit: 'Natural Earth',
    url: NE('ne_50m_glaciated_areas'),
    kind: 'fill',
    color: '#f4fbff',
    size: '0.5 MB',
    prep: keep('name'),
  },
  {
    id: 'iceshelves',
    name: 'Antarctic ice shelves',
    desc: 'Floating ice around Antarctica',
    credit: 'Natural Earth',
    url: NE('ne_50m_antarctic_ice_shelves_polys'),
    kind: 'fill',
    color: '#e8f4fb',
    size: '0.1 MB',
    prep: keep('name'),
  },
  {
    id: 'ranges',
    name: 'Deserts, ranges & plains',
    desc: 'Names of mountain ranges, deserts, plateaus, basins…',
    credit: 'Natural Earth',
    url: NE('ne_10m_geography_regions_points'),
    kind: 'point',
    color: '#6b4a2b',
    label: 'name',
    size: '0.3 MB',
    prep: keep('name', 'featurecla', 'scalerank'),
    layers: (id, o) => [
      {
        id,
        type: 'symbol',
        source: id,
        filter: ['<=', ['to-number', ['get', 'scalerank']], ['step', ['zoom'], 2, 3, 4, 5, 6]],
        layout: {
          'text-field': ['upcase', ['get', 'name']],
          'text-font': ['Open Sans Semibold Italic'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 8, 6, 13],
          'text-letter-spacing': 0.3,
          'text-max-width': 8,
          'symbol-sort-key': ['to-number', ['get', 'scalerank']],
        },
        paint: { 'text-color': o.color, 'text-halo-color': 'rgba(255,255,255,0.6)', 'text-halo-width': 1 },
      },
    ],
  },
  {
    id: 'peaks',
    name: 'Mountain peaks',
    desc: 'Summits with their height',
    credit: 'Natural Earth',
    url: NE('ne_10m_geography_regions_elevation_points'),
    kind: 'point',
    color: '#5b3a1e',
    label: 'name',
    size: '0.9 MB',
    prep: keep('name', 'elevation', 'scalerank'),
    layers: (id, o) => [
      {
        id,
        type: 'symbol',
        source: id,
        minzoom: 2.5,
        filter: ['<=', ['to-number', ['get', 'scalerank']], ['step', ['zoom'], 2, 4, 4, 6, 6, 8, 9]],
        layout: {
          'text-field': ['format', '▲ ', {}, ['get', 'name'], {}, ['concat', '\n', ['to-string', ['get', 'elevation']], ' m'], { 'font-scale': 0.8 }],
          'text-font': ['Open Sans Semibold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 9, 8, 12],
          'text-max-width': 9,
          'symbol-sort-key': ['to-number', ['get', 'scalerank']],
        },
        paint: { 'text-color': o.color, 'text-halo-color': 'rgba(255,255,255,0.75)', 'text-halo-width': 1.1 },
      },
    ],
  },
  {
    id: 'plates',
    name: 'Tectonic plates',
    desc: 'Boundaries between the Earth’s plates',
    credit: 'Bird (2003), via H. Ahlenius',
    url: 'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json',
    kind: 'line',
    color: '#d1495b',
    size: '0.2 MB',
    prep: keep('Name', 'Type'),
    layers: (id, o) => [
      { id, type: 'line', source: id, paint: { 'line-color': o.color, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1, 6, 2.4], 'line-opacity': 0.8, 'line-dasharray': [4, 2] } },
    ],
  },
  {
    id: 'timezones',
    name: 'Time zones',
    desc: 'Official time zones, as outlines',
    credit: 'Natural Earth',
    url: NE('ne_10m_time_zones'),
    kind: 'line',
    color: '#7b6cd9',
    label: 'time_zone',
    size: '3.5 MB',
    prep: keep('time_zone', 'name'),
    layers: (id, o) => [
      { id, type: 'line', source: id, paint: { 'line-color': o.color, 'line-width': 0.8, 'line-opacity': 0.6 } },
      {
        id: `${id}-labels`,
        type: 'symbol',
        source: id,
        minzoom: 2,
        layout: { 'text-field': ['get', 'time_zone'], 'text-font': ['Open Sans Semibold'], 'text-size': 10, 'symbol-placement': 'point' },
        paint: { 'text-color': o.color, 'text-halo-color': 'rgba(255,255,255,0.7)', 'text-halo-width': 1 },
      },
    ],
  },
  {
    id: 'ports',
    name: 'Seaports',
    desc: 'Major ports',
    credit: 'Natural Earth',
    url: NE('ne_10m_ports'),
    kind: 'point',
    color: '#1f6fb8',
    label: 'name',
    size: '0.3 MB',
    prep: keep('name', 'scalerank'),
  },
  {
    id: 'airports',
    name: 'Airports',
    desc: 'Major airports',
    credit: 'Natural Earth',
    url: NE('ne_10m_airports'),
    kind: 'point',
    color: '#59606e',
    label: 'name',
    size: '1.2 MB',
    prep: keep('name', 'iata_code', 'scalerank'),
  },
  {
    id: 'quakes',
    name: 'Earthquakes (last 30 days)',
    desc: 'Magnitude 4.5 and above, live',
    credit: 'USGS',
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson',
    kind: 'point',
    color: '#e4572e',
    live: true,
    label: 'place',
    size: '0.4 MB',
    prep: keep('mag', 'place', 'time'),
    layers: (id, o) => [
      {
        id,
        type: 'circle',
        source: id,
        paint: {
          'circle-color': o.color,
          'circle-opacity': 0.55,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 0.8,
          'circle-radius': ['interpolate', ['linear'], ['to-number', ['get', 'mag']], 4.5, 2.5, 6, 6, 8, 14],
        },
      },
    ],
  },
  {
    id: 'events',
    name: 'Natural events',
    desc: 'Wildfires, storms, volcanoes and ice happening now',
    credit: 'NASA EONET',
    url: 'https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&days=60',
    kind: 'point',
    color: '#f18f01',
    live: true,
    label: 'title',
    size: '1 MB',
    prep: (fc) => ({
      type: 'FeatureCollection',
      features: fc.features
        .filter((f) => f.geometry?.type === 'Point')
        .map((f) => {
          const cats = (f.properties?.categories ?? []) as { id?: string; title?: string }[];
          return { ...f, properties: { title: f.properties?.title ?? '', cat: cats[0]?.id ?? '' } };
        }),
    }),
    layers: (id) => [
      {
        id,
        type: 'circle',
        source: id,
        paint: {
          'circle-color': ['match', ['get', 'cat'], 'wildfires', '#e4572e', 'volcanoes', '#8e2c1f', 'severeStorms', '#3d7dd8', 'seaLakeIce', '#7fc8f8', '#f18f01'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3, 6, 6],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
          'circle-opacity': 0.85,
        },
      },
    ],
  },
];

export const overlayById = (id: string) => OVERLAYS.find((o) => o.id === id);

const CACHE = 'ev-data-v1';
const loaded = new Map<string, Promise<FeatureCollection>>();

/** The overlay's data: from the network for live feeds (cache as fallback), else cache first. */
export function loadOverlay(o: Overlay): Promise<FeatureCollection> {
  let p = loaded.get(o.id);
  if (!p) {
    p = fetchCached(o.url, !!o.live).then((fc) => (o.prep ? o.prep(fc) : fc));
    p.catch(() => loaded.delete(o.id));
    loaded.set(o.id, p);
  }
  return p;
}

async function fetchCached(url: string, live: boolean): Promise<FeatureCollection> {
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null;
  const cached = cache ? await cache.match(url) : undefined;
  if (cached && !live) return cached.json();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (cache) await cache.put(url, res.clone()).catch(() => {});
    return res.json();
  } catch (e) {
    if (cached) return cached.json();
    throw e;
  }
}

/** Whether the overlay has been downloaded already (works offline). */
export async function isCached(o: Overlay): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  const cache = await caches.open(CACHE).catch(() => null);
  return !!(cache && (await cache.match(o.url)));
}

/** Default layers when an overlay doesn't define its own. */
function defaultLayers(id: string, o: Overlay): LayerSpecification[] {
  if (o.kind === 'fill')
    return [
      { id, type: 'fill', source: id, paint: { 'fill-color': o.color, 'fill-opacity': 0.85 } },
      { id: `${id}-line`, type: 'line', source: id, paint: { 'line-color': 'rgba(120,150,180,0.6)', 'line-width': 0.6 } },
    ];
  if (o.kind === 'line') return [{ id, type: 'line', source: id, paint: { 'line-color': o.color, 'line-width': 1.4 } }];
  return [
    {
      id,
      type: 'circle',
      source: id,
      paint: { 'circle-color': o.color, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2, 6, 4.5], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 },
    },
    ...(o.label
      ? [
          {
            id: `${id}-labels`,
            type: 'symbol',
            source: id,
            minzoom: 4,
            layout: { 'text-field': ['get', o.label], 'text-font': ['Open Sans Semibold'], 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.5], 'text-optional': true },
            paint: { 'text-color': o.color, 'text-halo-color': 'rgba(255,255,255,0.8)', 'text-halo-width': 1.1 },
          } as LayerSpecification,
        ]
      : []),
  ];
}

/** Shows exactly the overlays in `ids` on the map (adding sources and layers as their data arrives). */
export function syncOverlays(map: MLMap, ids: string[], onError: (o: Overlay) => void) {
  const want = new Set(ids);
  for (const o of OVERLAYS) {
    const src = `ov-${o.id}`;
    const layers = (o.layers ?? defaultLayers)(src, o);
    if (!want.has(o.id)) {
      for (const l of layers) if (map.getLayer(l.id)) map.removeLayer(l.id);
      if (map.getSource(src)) map.removeSource(src);
      continue;
    }
    if (map.getSource(src)) continue;
    loadOverlay(o).then(
      (data) => {
        // Turned off (or the map closed) while loading.
        if (!map.getStyle() || map.getSource(src) || !overlayWanted(o.id)) return;
        map.addSource(src, { type: 'geojson', data });
        const before = o.kind === 'fill' ? 'occupation' : 'mark-casing';
        for (const l of layers) map.addLayer(l, map.getLayer(before) ? before : undefined);
      },
      () => onError(o),
    );
  }
}

/** Layer ids of the overlays shown, for hover tips. */
export function overlayLayerIds(ids: string[]): { layer: string; o: Overlay }[] {
  const out: { layer: string; o: Overlay }[] = [];
  for (const id of ids) {
    const o = overlayById(id);
    if (o?.label) out.push({ layer: `ov-${o.id}`, o });
  }
  return out;
}

let wanted: () => string[] = () => [];
export function setOverlayWanted(fn: () => string[]) {
  wanted = fn;
}
const overlayWanted = (id: string) => wanted().includes(id);
