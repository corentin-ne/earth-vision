import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { MapStyleId } from '../world/store';

/** Absolute URL of a bundled file; keeps `{z}`-style template tokens unescaped. */
export const asset = (p: string) => new URL(p, document.baseURI).href.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function graticule(step = 15): FeatureCollection {
  const features: FeatureCollection['features'] = [];
  for (let lng = -180; lng <= 180; lng += step) {
    const coords = [];
    for (let lat = -80; lat <= 80; lat += 2) coords.push([lng, lat]);
    features.push({ type: 'Feature', properties: { eq: false }, geometry: { type: 'LineString', coordinates: coords } });
  }
  for (let lat = -75; lat <= 75; lat += step) {
    const coords = [];
    for (let lng = -180; lng <= 180; lng += 2) coords.push([lng, lat]);
    features.push({ type: 'Feature', properties: { eq: lat === 0 }, geometry: { type: 'LineString', coordinates: coords } });
  }
  return { type: 'FeatureCollection', features };
}

export interface Look {
  ocean: string;
  /** Colour of land nobody owns; null lets the relief show through. */
  unclaimed: string | null;
  fillOpacity: number;
  /** Opaque fills get a hairline in their own colour to hide seams between regions. */
  seam: boolean;
  reliefBrightness: number;
  hillshade: boolean;
  /** Darkening veil drawn over the land, for the night look. */
  veil: number;
  graticule: string;
  countryBorder: string;
  countryBorderOpacity: number;
  countryBorderWidth: number;
  regionBorder: string;
  coast: string;
  lake: string;
  river: string;
  urban: string;
  label: string;
  labelHalo: string;
  labelUpper: boolean;
  regionLabel: string;
  cityLabel: string;
  waterLabel: string;
  sky: { sky: string; horizon: string; fog: string };
  selection: string;
}

export const LOOKS: Record<MapStyleId, Look> = {
  political: {
    ocean: '#c4def0',
    unclaimed: null,
    fillOpacity: 1,
    seam: true,
    reliefBrightness: 1,
    hillshade: true,
    veil: 0,
    graticule: 'rgba(40,70,110,0.08)',
    countryBorder: '#2b2b3d',
    countryBorderOpacity: 0.85,
    countryBorderWidth: 1.1,
    regionBorder: 'rgba(255,255,255,0.6)',
    coast: 'rgba(40,80,120,0.55)',
    lake: '#c4def0',
    river: '#6fa8d6',
    urban: 'rgba(120,90,60,0.18)',
    label: '#1b2333',
    labelHalo: 'rgba(255,255,255,0.85)',
    labelUpper: false,
    regionLabel: 'rgba(30,40,60,0.62)',
    cityLabel: '#222a38',
    waterLabel: '#4b78a8',
    sky: { sky: '#c8dff0', horizon: '#e8f4fc', fog: '#e8f4fc' },
    selection: '#ff2d55',
  },
  atlas: {
    ocean: '#e2f3fd',
    unclaimed: null,
    fillOpacity: 0.14,
    seam: false,
    reliefBrightness: 1,
    hillshade: false,
    veil: 0,
    graticule: 'rgba(0,0,0,0.06)',
    countryBorder: 'rgb(179,1,158)',
    countryBorderOpacity: 0.6,
    countryBorderWidth: 1.4,
    regionBorder: 'rgba(179,1,158,0.22)',
    coast: 'rgba(0,140,190,0.45)',
    lake: '#e2f3fd',
    river: '#00acd4',
    urban: 'rgba(255,188,82,0.5)',
    label: 'rgb(124,53,95)',
    labelHalo: 'rgba(255,255,255,0.9)',
    labelUpper: true,
    regionLabel: 'rgba(124,53,95,0.7)',
    cityLabel: '#1a2a3a',
    waterLabel: '#6c9dc4',
    sky: { sky: '#c8dff0', horizon: '#e8f4fc', fog: '#e8f4fc' },
    selection: '#ff0f5f',
  },
  plain: {
    ocean: '#bce0fb',
    unclaimed: '#f2efe6',
    fillOpacity: 1,
    seam: true,
    reliefBrightness: 1,
    hillshade: false,
    veil: 0,
    graticule: 'rgba(0,0,0,0.05)',
    countryBorder: '#171717',
    countryBorderOpacity: 1,
    countryBorderWidth: 1,
    regionBorder: 'rgba(128,128,128,0.8)',
    coast: 'rgba(23,23,23,0.9)',
    lake: '#bce0fb',
    river: '#7fb7e6',
    urban: 'rgba(0,0,0,0)',
    label: '#08254d',
    labelHalo: 'rgba(255,255,255,0.95)',
    labelUpper: false,
    regionLabel: 'rgba(8,37,77,0.75)',
    cityLabel: '#08254d',
    waterLabel: 'rgba(73,94,145,0.8)',
    sky: { sky: '#bce0fb', horizon: '#e8f4fc', fog: '#e8f4fc' },
    selection: '#ff0000',
  },
  night: {
    ocean: '#0a1220',
    unclaimed: null,
    fillOpacity: 1,
    seam: true,
    reliefBrightness: 0.55,
    hillshade: true,
    veil: 0.58,
    graticule: 'rgba(160,190,255,0.07)',
    countryBorder: '#e9ecff',
    countryBorderOpacity: 0.75,
    countryBorderWidth: 1,
    regionBorder: 'rgba(233,236,255,0.14)',
    coast: 'rgba(140,180,255,0.45)',
    lake: '#0a1220',
    river: '#3d6fa8',
    urban: 'rgba(255,200,90,0.35)',
    label: '#f3f5ff',
    labelHalo: 'rgba(8,12,24,0.85)',
    labelUpper: true,
    regionLabel: 'rgba(225,230,255,0.6)',
    cityLabel: '#f3f5ff',
    waterLabel: '#6f8fc0',
    sky: { sky: '#050913', horizon: '#1a2c4d', fog: '#0a1220' },
    selection: '#ffcc00',
  },
};

const zoomWidth = (base: number): ExpressionSpecification => ['interpolate', ['exponential', 1.6], ['zoom'], 1, base * 0.6, 4, base * 1.2, 8, base * 2.6];

/** Static skeleton of the style: every source and layer exists from the start; looks are applied afterwards. */
export function baseStyle(): StyleSpecification {
  const empty = () => ({ type: 'geojson' as const, data: EMPTY });
  return {
    version: 8,
    glyphs: asset('fonts/{fontstack}/{range}.pbf'),
    projection: { type: 'globe' },
    sources: {
      relief: {
        type: 'raster',
        tiles: [asset('tiles/relief/{z}/{x}/{y}.webp')],
        tileSize: 512,
        maxzoom: 4,
        attribution: 'Relief & data: <a href="https://www.naturalearthdata.com">Natural Earth</a>',
      },
      dem: {
        type: 'raster-dem',
        tiles: [asset('tiles/dem/{z}/{x}/{y}.png')],
        tileSize: 256,
        maxzoom: 4,
        encoding: 'terrarium',
        attribution: 'Elevation: Mapzen / AWS Terrain Tiles',
      },
      'dem-terrain': {
        type: 'raster-dem',
        tiles: [asset('tiles/dem/{z}/{x}/{y}.png')],
        tileSize: 256,
        maxzoom: 4,
        encoding: 'terrarium',
      },
      graticule: { type: 'geojson', data: graticule() },
      veil: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] } } },
      lakes: { type: 'geojson', data: asset('data/lakes.json') },
      rivers: { type: 'geojson', data: asset('data/rivers.json') },
      urban: { type: 'geojson', data: asset('data/urban.json') },
      marine: { type: 'geojson', data: asset('data/marine.json') },
      regions: { type: 'geojson', data: EMPTY, tolerance: 0.3 },
      'borders-country': empty(),
      'borders-region': empty(),
      coast: empty(),
      selection: empty(),
      'region-labels': empty(),
      'country-labels': empty(),
      cities: empty(),
      water: empty(),
      draw: empty(),
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': '#c4def0' } },
      { id: 'graticule', type: 'line', source: 'graticule', paint: { 'line-color': 'rgba(0,0,0,0.06)', 'line-width': ['case', ['get', 'eq'], 1.4, 0.8] } },
      { id: 'relief', type: 'raster', source: 'relief', paint: { 'raster-resampling': 'linear', 'raster-fade-duration': 0 } },
      {
        id: 'region-fill',
        type: 'fill',
        source: 'regions',
        paint: { 'fill-color': ['to-color', ['coalesce', ['feature-state', 'color'], '#ece6d3']], 'fill-antialias': true },
      },
      {
        // Hairline in the fill colour hides anti-aliasing seams between same-colour regions.
        id: 'region-seam',
        type: 'line',
        source: 'regions',
        paint: { 'line-color': ['to-color', ['coalesce', ['feature-state', 'color'], '#ece6d3']], 'line-width': 0.7 },
      },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'dem',
        maxzoom: 9,
        paint: {
          'hillshade-shadow-color': 'rgba(40,40,70,0.55)',
          'hillshade-highlight-color': 'rgba(255,255,255,0.35)',
          'hillshade-accent-color': 'rgba(40,40,70,0.25)',
          'hillshade-exaggeration': 0.55,
        },
      },
      { id: 'veil', type: 'fill', source: 'veil', paint: { 'fill-color': '#050a18', 'fill-opacity': 0 }, layout: { visibility: 'none' } },
      { id: 'urban', type: 'fill', source: 'urban', minzoom: 3.5, paint: { 'fill-color': 'rgba(0,0,0,0.1)' } },
      { id: 'lakes', type: 'fill', source: 'lakes', paint: { 'fill-color': '#c4def0' } },
      { id: 'lakes-line', type: 'line', source: 'lakes', paint: { 'line-color': 'rgba(40,80,120,0.4)', 'line-width': 0.6 } },
      {
        id: 'rivers',
        type: 'line',
        source: 'rivers',
        minzoom: 2,
        filter: ['<=', ['get', 'scalerank'], ['step', ['zoom'], 4, 3, 6, 4.5, 8, 6, 12]],
        paint: { 'line-color': '#6fa8d6', 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.4, 6, 1.3, 9, 2] },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        id: 'region-hl',
        type: 'fill',
        source: 'regions',
        paint: {
          'fill-color': '#ffffff',
          'fill-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 0.42, ['boolean', ['feature-state', 'hover'], false], 0.22, 0],
        },
      },
      {
        id: 'region-borders',
        type: 'line',
        source: 'borders-region',
        minzoom: 2.5,
        paint: { 'line-color': 'rgba(255,255,255,0.5)', 'line-width': ['interpolate', ['linear'], ['zoom'], 2.5, 0.3, 6, 0.8, 10, 1.4], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 2.5, 0, 3.5, 1] },
        layout: { 'line-join': 'round' },
      },
      { id: 'coast', type: 'line', source: 'coast', paint: { 'line-color': 'rgba(40,80,120,0.5)', 'line-width': zoomWidth(0.8) }, layout: { 'line-join': 'round' } },
      {
        id: 'country-borders-casing',
        type: 'line',
        source: 'borders-country',
        minzoom: 3,
        paint: { 'line-color': 'rgba(255,255,255,0.6)', 'line-width': zoomWidth(3), 'line-opacity': 0.5 },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      },
      {
        id: 'country-borders',
        type: 'line',
        source: 'borders-country',
        paint: { 'line-color': '#2b2b3d', 'line-width': zoomWidth(1.1) },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      },
      {
        id: 'selection-halo',
        type: 'line',
        source: 'selection',
        paint: { 'line-color': '#ffffff', 'line-width': ['case', ['==', ['get', 'kind'], 'country'], 6, 4], 'line-opacity': 0.75, 'line-blur': 1 },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      },
      {
        id: 'selection',
        type: 'line',
        source: 'selection',
        filter: ['==', ['get', 'kind'], 'country'],
        paint: { 'line-color': '#ff2d55', 'line-width': 2.4 },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      },
      {
        id: 'selection-regions',
        type: 'line',
        source: 'selection',
        filter: ['==', ['get', 'kind'], 'region'],
        paint: { 'line-color': '#ff2d55', 'line-width': 1.8, 'line-dasharray': [2, 1.2] },
        layout: { 'line-join': 'round' },
      },
      { id: 'draw-line', type: 'line', source: 'draw', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#ff2d55', 'line-width': 2.5, 'line-dasharray': [2, 1] } },
      {
        id: 'draw-points',
        type: 'circle',
        source: 'draw',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 4.5, 'circle-color': '#ffffff', 'circle-stroke-color': '#ff2d55', 'circle-stroke-width': 2 },
      },
      {
        id: 'marine-labels',
        type: 'symbol',
        source: 'marine',
        filter: ['<=', ['get', 'rank'], ['step', ['zoom'], 1, 2, 2, 3, 3, 4, 5]],
        layout: {
          'text-field': ['upcase', ['get', 'name']],
          'text-font': ['Open Sans Semibold Italic'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, ['case', ['==', ['get', 'kind'], 'ocean'], 11, 8], 5, ['case', ['==', ['get', 'kind'], 'ocean'], 16, 12]],
          'text-letter-spacing': ['case', ['==', ['get', 'kind'], 'ocean'], 0.45, 0.2],
          'text-max-width': 8,
          'symbol-sort-key': ['get', 'rank'],
        },
        paint: { 'text-color': '#6c9dc4', 'text-halo-color': 'rgba(255,255,255,0.5)', 'text-halo-width': 1 },
      },
      {
        id: 'water-labels',
        type: 'symbol',
        source: 'water',
        filter: ['<=', ['get', 'rank'], ['step', ['zoom'], 0, 2.5, 1, 4, 2, 5.5, 3]],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Semibold Italic'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, ['match', ['get', 'rank'], 0, 11, 8], 6, ['match', ['get', 'rank'], 0, 17, 1, 13, 11]],
          'text-letter-spacing': ['match', ['get', 'rank'], 0, 0.35, 0.12],
          'text-max-width': 8,
          'symbol-sort-key': ['get', 'rank'],
        },
        paint: { 'text-color': '#4b78a8', 'text-halo-color': 'rgba(255,255,255,0.5)', 'text-halo-width': 1 },
      },
      {
        id: 'region-labels',
        type: 'symbol',
        source: 'region-labels',
        minzoom: 4.6,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Semibold Italic'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4.6, 9, 8, 13],
          'text-max-width': 7,
          'text-padding': 4,
          'symbol-sort-key': ['-', ['get', 'area']],
        },
        paint: { 'text-color': 'rgba(30,40,60,0.6)', 'text-halo-color': 'rgba(255,255,255,0.7)', 'text-halo-width': 1.2 },
      },
      {
        id: 'cities',
        type: 'symbol',
        source: 'cities',
        minzoom: 5,
        filter: ['all', ['!', ['get', 'capital']], ['!', ['get', 'hidden']]],
        layout: {
          'icon-image': 'city-dot',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.7, 8, 1],
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Semibold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 8, 13],
          'text-variable-anchor': ['top', 'bottom', 'right', 'left'],
          'text-radial-offset': 0.6,
          'text-max-width': 8,
          'symbol-sort-key': ['-', ['coalesce', ['get', 'pop'], 0]],
        },
        paint: { 'text-color': '#222a38', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.3 },
      },
      {
        id: 'capitals',
        type: 'symbol',
        source: 'cities',
        minzoom: 2.4,
        filter: ['all', ['get', 'capital'], ['!', ['get', 'hidden']]],
        layout: {
          'icon-image': 'city-capital',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 7, 1],
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 2.4, 9, 8, 14],
          'text-variable-anchor': ['top', 'bottom', 'right', 'left'],
          'text-radial-offset': 0.7,
          'text-max-width': 8,
        },
        paint: { 'text-color': '#222a38', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.4 },
      },
      {
        id: 'country-labels',
        type: 'symbol',
        source: 'country-labels',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, ['+', 7.5, ['*', 6, ['get', 's']]], 4, ['+', 10, ['*', 11, ['get', 's']]], 7, ['+', 13, ['*', 15, ['get', 's']]]],
          'text-max-width': 7,
          'text-letter-spacing': 0.04,
          'text-padding': 6,
          'text-anchor': 'top',
          'icon-image': ['get', 'flag'],
          'icon-anchor': 'bottom',
          'icon-offset': [0, -2],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 1, ['+', 0.4, ['*', 0.35, ['get', 's']]], 5, ['+', 0.65, ['*', 0.45, ['get', 's']]]],
          'icon-optional': true,
          'symbol-sort-key': ['-', ['get', 's']],
        },
        paint: { 'text-color': '#1b2333', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.6 },
      },
    ],
  };
}
