import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { MapStyleId } from '../world/store';

/** Absolute URL of a bundled file; keeps `{z}`-style template tokens unescaped. */
export const asset = (p: string) => new URL(p, document.baseURI).href.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function graticule(step = 15): FeatureCollection {
  const features: FeatureCollection['features'] = [];
  // -180 and 180 are the same meridian: drawing both would double it.
  for (let lng = -180; lng < 180; lng += step) {
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
  /** Beyond the depth tiles (polar caps). */
  ocean: string;
  /** Water colour by depth (metres, negative), shallowest first. */
  depth: [number, string][];
  /** Animated water surface: glint colour, shaded-side colour, strength (0 = none). */
  water: { light: string; shade: string; strength: number };
  /** Land under everything else, so water effects never show through bare land. */
  landBase: string;
  /** Colour of land nobody owns; null lets the relief show through. */
  unclaimed: string | null;
  fillOpacity: number;
  /** Opaque fills get a hairline in their own colour to hide seams between regions. */
  seam: boolean;
  reliefBrightness: number;
  hillshade: boolean;
  /**
   * How the mountains are lit: `main` is the crisp light from the north-west, `deep` a second,
   * low sun that only adds long shadows (both 0–1); `contrast` sharpens the relief colours.
   */
  shade: { main: number; deep: number; shadow: string; highlight: string; contrast: number };
  /**
   * Height colours (0 = none): how far a country's single colour deepens toward `low` on the
   * lowest ground and pales toward `peak` on the summits (see `autoGradient`).
   */
  tint: { strength: number; low: string; peak: string };
  /** How much richer the country colours are drawn than they are stored (0 = as picked). */
  vivid: number;
  /** Darkening veil drawn over the land, for the night look. */
  veil: number;
  graticule: string;
  countryBorder: string;
  countryBorderOpacity: number;
  countryBorderWidth: number;
  regionBorder: string;
  coast: string;
  /** Soft light band on the water side of every coast. */
  coastGlow: string;
  /** Faint shadow the land casts on the water, lifting it off the sea. */
  coastShadow: string;
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
    ocean: '#86b3d6',
    depth: [[0, '#e3f1f5'], [-40, '#d0e7f0'], [-160, '#bcdaea'], [-700, '#a7cce2'], [-2500, '#98c0db'], [-5000, '#8bb5d4'], [-8000, '#7faacb']],
    water: { light: '#ffffff', shade: '#1d4f7a', strength: 0.5 },
    landBase: '#e8e2d0',
    unclaimed: null,
    fillOpacity: 1,
    seam: true,
    reliefBrightness: 1,
    hillshade: true,
    shade: { main: 0.95, deep: 0.75, shadow: 'rgba(8,14,26,0.5)', highlight: 'rgba(255,255,255,0.22)', contrast: 0.12 },
    tint: { strength: 1, low: '8,14,26', peak: '250,250,247' },
    vivid: 0.7,
    veil: 0,
    graticule: 'rgba(40,70,110,0.08)',
    countryBorder: '#2b2b3d',
    countryBorderOpacity: 0.85,
    countryBorderWidth: 1.1,
    regionBorder: 'rgba(255,255,255,0.32)',
    coast: 'rgba(30,50,80,0.5)',
    coastGlow: 'rgba(240,250,255,0.75)',
    coastShadow: 'rgba(16,48,92,0.32)',
    lake: '#c9e4f4',
    river: '#6fa8d6',
    urban: 'rgba(120,90,60,0.18)',
    label: '#1b2333',
    labelHalo: 'rgba(255,255,255,0.85)',
    labelUpper: false,
    regionLabel: 'rgba(30,40,60,0.62)',
    cityLabel: '#222a38',
    waterLabel: '#4b78a8',
    sky: { sky: '#9cc6e6', horizon: '#e4f2fb', fog: '#e4f2fb' },
    selection: '#ff2d55',
  },
  atlas: {
    ocean: '#c4e2f5',
    depth: [[0, '#f2fbfe'], [-60, '#e6f6fc'], [-200, '#d9f0fa'], [-2000, '#cfe9f8'], [-6000, '#c4e2f5']],
    water: { light: '#ffffff', shade: '#3a7aa8', strength: 0.4 },
    landBase: '#efe9dc',
    unclaimed: null,
    fillOpacity: 0.14,
    seam: false,
    reliefBrightness: 1,
    hillshade: true,
    shade: { main: 0.85, deep: 0.6, shadow: 'rgba(14,16,22,0.45)', highlight: 'rgba(255,255,255,0.2)', contrast: 0.22 },
    tint: { strength: 0.45, low: '14,16,22', peak: '255,255,255' },
    vivid: 0.6,
    veil: 0,
    graticule: 'rgba(0,0,0,0.06)',
    countryBorder: 'rgb(179,1,158)',
    countryBorderOpacity: 0.6,
    countryBorderWidth: 1.4,
    regionBorder: 'rgba(179,1,158,0.22)',
    coast: 'rgba(0,140,190,0.45)',
    coastGlow: 'rgba(255,255,255,0.85)',
    coastShadow: 'rgba(0,90,140,0.16)',
    lake: '#e4f4fd',
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
    ocean: '#9ccdf2',
    depth: [[0, '#cbe9fc'], [-200, '#b8e0fa'], [-3000, '#a8d6f6'], [-7000, '#9ccdf2']],
    water: { light: '#ffffff', shade: '#2a6aa0', strength: 0.3 },
    landBase: '#f2efe6',
    unclaimed: '#f2efe6',
    fillOpacity: 1,
    seam: true,
    reliefBrightness: 1,
    hillshade: false,
    shade: { main: 0, deep: 0, shadow: 'rgba(0,0,0,0)', highlight: 'rgba(0,0,0,0)', contrast: 0 },
    tint: { strength: 0, low: '0,0,0', peak: '255,255,255' },
    vivid: 0,
    veil: 0,
    graticule: 'rgba(0,0,0,0.05)',
    countryBorder: '#171717',
    countryBorderOpacity: 1,
    countryBorderWidth: 1,
    regionBorder: 'rgba(128,128,128,0.8)',
    coast: 'rgba(23,23,23,0.9)',
    coastGlow: 'rgba(255,255,255,0.6)',
    coastShadow: 'rgba(0,0,0,0.14)',
    lake: '#c3e4fb',
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
    ocean: '#040a17',
    depth: [[0, '#1b4a73'], [-60, '#143a61'], [-200, '#0e2a4b'], [-1500, '#0a1d38'], [-4000, '#07142a'], [-8000, '#040a17']],
    water: { light: '#9fe8ff', shade: '#000814', strength: 0.45 },
    landBase: '#161d2b',
    unclaimed: null,
    fillOpacity: 1,
    seam: true,
    reliefBrightness: 0.55,
    hillshade: true,
    shade: { main: 1, deep: 0.7, shadow: 'rgba(0,2,12,0.8)', highlight: 'rgba(150,190,255,0.28)', contrast: 0.1 },
    tint: { strength: 0.7, low: '0,4,16', peak: '200,225,255' },
    vivid: 0.8,
    veil: 0.58,
    graticule: 'rgba(160,190,255,0.07)',
    countryBorder: '#e9ecff',
    countryBorderOpacity: 0.75,
    countryBorderWidth: 1,
    regionBorder: 'rgba(233,236,255,0.14)',
    coast: 'rgba(140,180,255,0.45)',
    coastGlow: 'rgba(110,190,255,0.22)',
    coastShadow: 'rgba(0,0,0,0.55)',
    lake: '#0d203d',
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

const vividCache = new Map<string, string>();
/**
 * A stored colour as the map draws it: more saturated and a little deeper, so pastel palettes
 * come out rich under the shading (the stored colour, and every swatch, stay as picked).
 */
export function vivid(hex: string, k: number): string {
  if (k <= 0) return hex;
  const key = hex + k;
  const hit = vividCache.get(key);
  if (hit) return hit;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let l = (max + min) / 2;
  const d = max - min;
  let sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  // Greys stay grey; everything else gains saturation, and light colours come down toward mid-tones.
  if (sat > 0.04) sat = Math.min(0.66, sat * (1 + 0.15 * k));
  l = l - Math.max(0, l - 0.5) * 0.72 * k;
  const c = (1 - Math.abs(2 * l - 1)) * sat;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const [r1, g1, b1] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  const out = '#' + [r1, g1, b1].map((v) => Math.round((v + l - c / 2) * 255).toString(16).padStart(2, '0')).join('');
  vividCache.set(key, out);
  return out;
}

/** Heights (metres) the key is defined at: evenly spaced on a logarithmic scale, so the plains get as much of the gradient as the high ranges. */
const KEY_STOPS = [8, 12, 18, 27, 40, 60, 85, 120, 170, 240, 340, 480, 680, 950, 1300, 1750, 2300, 3000, 3800, 4700];
/**
 * Everything under this height is the same lowest ground. The elevation data and the regions
 * do not agree to the metre on where the sea starts, and a logarithmic scale would turn the
 * few metres between a beach, a polder and "sea level inside the coast" into dark blotches.
 */
const KEY_FLOOR = KEY_STOPS[0];

/**
 * The height key as a `color-relief` ramp (see gradient.ts): its red channel says how high the
 * ground is — 0 the lowest ground, 0.5 the hills around `pivot`, 1 the highest peaks. The scale
 * is logarithmic (20 m against 40 m shows as clearly as 2,000 m against 4,000 m) and smooth:
 * a continuous gradient, no steps.
 */
export function keyRamp(): ExpressionSpecification {
  const top = Math.log(KEY_STOPS[KEY_STOPS.length - 1] / KEY_FLOOR);
  // The hills (the country's own colour) sit around 150 m.
  const pivot = Math.log(150 / KEY_FLOOR) / top;
  const level = (metres: number) => {
    const x = Math.max(0, Math.log(Math.max(KEY_FLOOR, metres) / KEY_FLOOR) / top);
    const t = x < pivot ? 0.5 * (1 - ((pivot - x) / pivot) ** 1.1) : 0.5 + 0.5 * Math.min(1, (x - pivot) / (1 - pivot)) ** 1.15;
    return Math.round(Math.max(0, Math.min(1, t)) * 255);
  };
  const stops: (number | string)[] = [0, 'rgb(0,0,0)'];
  for (const m of KEY_STOPS) stops.push(m, `rgb(${level(m)},0,0)`);
  return ['interpolate', ['linear'], ['elevation'], ...stops] as unknown as ExpressionSpecification;
}

/** The three colours of a country's land from a single one: deeper lowlands, the colour itself, pale peaks. */
export function autoGradient(base: string, t: Look['tint']): [string, string, string] {
  const p = (h: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h);
    return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
  };
  const c = p(base);
  if (!c) return [base, base, base];
  const to = (target: string, k: number) => {
    const g = target.split(',').map(Number);
    return '#' + c.map((v, i) => Math.round(v + (g[i] - v) * Math.min(1, k)).toString(16).padStart(2, '0')).join('');
  };
  return [to(t.low, 0.3 * t.strength), base, to(t.peak, 0.94 * t.strength)];
}

/** A `color-relief` ramp from depth stops (any order). */
export function depthRamp(stops: [number, string][]): ExpressionSpecification {
  const sorted = [...stops].sort((a, b) => a[0] - b[0]);
  return ['interpolate', ['linear'], ['elevation'], ...sorted.flat()] as unknown as ExpressionSpecification;
}
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
        maxzoom: 5,
        attribution: 'Relief & data: <a href="https://www.naturalearthdata.com">Natural Earth</a>',
      },
      dem: {
        type: 'raster-dem',
        tiles: [asset('tiles/dem/{z}/{x}/{y}.webp')],
        tileSize: 256,
        maxzoom: 6,
        encoding: 'terrarium',
        attribution: 'Elevation: Mapzen / AWS Terrain Tiles',
      },
      // The same tiles once more: a source feeds one kind of elevation layer.
      'dem-tint': {
        type: 'raster-dem',
        tiles: [asset('tiles/dem/{z}/{x}/{y}.webp')],
        tileSize: 256,
        maxzoom: 6,
        encoding: 'terrarium',
      },
      'dem-terrain': {
        type: 'raster-dem',
        tiles: [asset('tiles/dem/{z}/{x}/{y}.webp')],
        tileSize: 256,
        maxzoom: 6,
        encoding: 'terrarium',
      },
      bathy: {
        type: 'raster-dem',
        tiles: [asset('tiles/bathy/{z}/{x}/{y}.png')],
        tileSize: 256,
        maxzoom: 3,
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
      occupied: empty(),
      'borders-state': empty(),
      // Whole arcs in every tile: a name along a line is dropped where a tile edge cuts it.
      'country-curves': { type: 'geojson', data: EMPTY, buffer: 512, tolerance: 0.2 },
      marks: empty(),
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': '#c4def0' } },
      // Water coloured by real sea-floor depth.
      { id: 'water-depth', type: 'color-relief', source: 'bathy', paint: { 'color-relief-color': depthRamp(LOOKS.political.depth) } },
      // The animated water surface (a custom WebGL layer, see water.ts) is inserted here, before the graticule.
      { id: 'graticule', type: 'line', source: 'graticule', paint: { 'line-color': 'rgba(0,0,0,0.06)', 'line-width': ['case', ['get', 'eq'], 1.4, 0.8] } },
      // Under the land, so only their sea side shows: a light shoreline glow, and the land's shadow.
      {
        id: 'coast-glow',
        type: 'line',
        source: 'coast',
        paint: {
          'line-color': 'rgba(255,255,255,0.7)',
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 1, 1.6, 4, 5, 8, 12],
          'line-blur': ['interpolate', ['exponential', 1.5], ['zoom'], 1, 1.4, 4, 4, 8, 9],
        },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      },
      {
        id: 'coast-shadow',
        type: 'line',
        source: 'coast',
        paint: {
          'line-color': 'rgba(16,48,92,0.3)',
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 1, 1, 4, 2.5, 8, 6],
          'line-blur': ['interpolate', ['exponential', 1.5], ['zoom'], 1, 1, 4, 2, 8, 5],
          'line-translate': [0.8, 1.4],
        },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      },
      { id: 'land-base', type: 'fill', source: 'regions', paint: { 'fill-color': '#e8e2d0', 'fill-antialias': false } },
      { id: 'relief', type: 'raster', source: 'relief', paint: { 'raster-resampling': 'linear', 'raster-fade-duration': 0 } },
      {
        id: 'region-fill',
        type: 'fill',
        source: 'regions',
        filter: ['!', ['to-boolean', ['get', 'polar']]],
        paint: { 'fill-color': ['to-color', ['coalesce', ['feature-state', 'color'], '#ece6d3']], 'fill-antialias': true },
      },
      {
        // Regions reaching a pole: on the globe the anti-aliased outline would ring the polar cap.
        id: 'region-fill-polar',
        type: 'fill',
        source: 'regions',
        filter: ['to-boolean', ['get', 'polar']],
        paint: { 'fill-color': ['to-color', ['coalesce', ['feature-state', 'color'], '#ece6d3']], 'fill-antialias': false },
      },
      {
        // Hairline in the fill colour hides anti-aliasing seams between same-colour regions.
        id: 'region-seam',
        type: 'line',
        source: 'regions',
        paint: { 'line-color': ['to-color', ['coalesce', ['feature-state', 'color'], '#ece6d3']], 'line-width': 0.7 },
      },
      // The same land twice more, in each country's hill and peak colours (see gradient.ts).
      {
        id: 'region-fill-mid',
        type: 'fill',
        source: 'regions',
        filter: ['!', ['to-boolean', ['get', 'polar']]],
        paint: { 'fill-color': ['to-color', ['coalesce', ['feature-state', 'c1'], '#ece6d3']], 'fill-antialias': true },
      },
      {
        // Regions reaching a pole: on the globe the anti-aliased outline would ring the polar cap.
        id: 'region-fill-mid-polar',
        type: 'fill',
        source: 'regions',
        filter: ['to-boolean', ['get', 'polar']],
        paint: { 'fill-color': ['to-color', ['coalesce', ['feature-state', 'c1'], '#ece6d3']], 'fill-antialias': false },
      },
      {
        // Hairline in the fill colour hides anti-aliasing seams between same-colour regions.
        id: 'region-seam-mid',
        type: 'line',
        source: 'regions',
        paint: { 'line-color': ['to-color', ['coalesce', ['feature-state', 'c1'], '#ece6d3']], 'line-width': 0.7 },
      },
      {
        id: 'region-fill-high',
        type: 'fill',
        source: 'regions',
        filter: ['!', ['to-boolean', ['get', 'polar']]],
        paint: { 'fill-color': ['to-color', ['coalesce', ['feature-state', 'c2'], '#ece6d3']], 'fill-antialias': true },
      },
      {
        // Regions reaching a pole: on the globe the anti-aliased outline would ring the polar cap.
        id: 'region-fill-high-polar',
        type: 'fill',
        source: 'regions',
        filter: ['to-boolean', ['get', 'polar']],
        paint: { 'fill-color': ['to-color', ['coalesce', ['feature-state', 'c2'], '#ece6d3']], 'fill-antialias': false },
      },
      {
        // Hairline in the fill colour hides anti-aliasing seams between same-colour regions.
        id: 'region-seam-high',
        type: 'line',
        source: 'regions',
        paint: { 'line-color': ['to-color', ['coalesce', ['feature-state', 'c2'], '#ece6d3']], 'line-width': 0.7 },
      },
      // The height key the three pictures of the land are blended by.
      { id: 'height-key', type: 'color-relief', source: 'dem-tint', paint: { 'color-relief-color': keyRamp() } },
      // Occupied land: stripes in the occupier's colour (one pattern image per colour, see controller).
      { id: 'occupation', type: 'fill', source: 'occupied', paint: { 'fill-pattern': ['get', 'pat'], 'fill-opacity': 0.85 } },
      {
        // The crisp light: every ridge and valley, lit from the north-west.
        id: 'hillshade',
        type: 'hillshade',
        source: 'dem',
        paint: {
          'hillshade-shadow-color': 'rgba(16,20,46,0.7)',
          'hillshade-highlight-color': 'rgba(255,251,236,0.5)',
          'hillshade-accent-color': 'rgba(16,20,46,0.35)',
          'hillshade-exaggeration': 1,
          'hillshade-illumination-anchor': 'map',
        },
      },
      {
        // A second, low sun that only casts shadows: the slopes facing away go properly dark,
        // which is what makes ranges stand out of the map.
        id: 'hillshade-deep',
        type: 'hillshade',
        source: 'dem',
        paint: {
          'hillshade-method': 'combined',
          'hillshade-illumination-altitude': 28,
          'hillshade-illumination-direction': 320,
          'hillshade-illumination-anchor': 'map',
          'hillshade-shadow-color': 'rgba(16,20,46,0.7)',
          'hillshade-highlight-color': 'rgba(255,255,255,0)',
          'hillshade-accent-color': 'rgba(0,0,0,0)',
          'hillshade-exaggeration': 0.8,
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
      {
        id: 'state-borders',
        type: 'line',
        source: 'borders-state',
        minzoom: 2,
        paint: { 'line-color': 'rgba(43,43,61,0.55)', 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 6, 1.2, 10, 2], 'line-dasharray': [3, 2] },
        layout: { 'line-join': 'round' },
      },
      { id: 'coast', type: 'line', source: 'coast', paint: { 'line-color': 'rgba(40,80,120,0.5)', 'line-width': zoomWidth(0.8) }, layout: { 'line-join': 'round' } },
      {
        id: 'country-borders-casing',
        type: 'line',
        source: 'borders-country',
        minzoom: 3,
        paint: { 'line-color': 'rgba(255,255,255,0.6)', 'line-width': zoomWidth(2.4), 'line-opacity': 0.22 },
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
      // Hand-drawn lines: roads, railways, trade routes, sea lanes, fronts, claimed borders.
      {
        id: 'mark-casing',
        type: 'line',
        source: 'marks',
        filter: ['all', ['==', ['get', 'type'], 'line'], ['match', ['get', 'kind'], ['road', 'rail', 'front'], true, false]],
        paint: { 'line-color': 'rgba(255,255,255,0.85)', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 2.2, 6, 5.5], 'line-blur': 0.5 },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      },
      {
        id: 'mark-solid',
        type: 'line',
        source: 'marks',
        filter: ['all', ['==', ['get', 'type'], 'line'], ['match', ['get', 'kind'], ['road', 'rail', 'front'], true, false]],
        paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 1, ['match', ['get', 'kind'], 'front', 2, 1.1], 6, ['match', ['get', 'kind'], 'front', 4.5, 3]] },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      },
      {
        // Railway sleepers: white dashes over the dark line.
        id: 'mark-rail-ties',
        type: 'line',
        source: 'marks',
        filter: ['all', ['==', ['get', 'type'], 'line'], ['==', ['get', 'kind'], 'rail']],
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 6, 1.4], 'line-dasharray': [2, 2] },
      },
      {
        id: 'mark-dash',
        type: 'line',
        source: 'marks',
        filter: ['all', ['==', ['get', 'type'], 'line'], ['match', ['get', 'kind'], ['route', 'border'], true, false]],
        paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.2, 6, 3], 'line-dasharray': [3, 1.6] },
        layout: { 'line-join': 'round' },
      },
      {
        id: 'mark-dot',
        type: 'line',
        source: 'marks',
        filter: ['all', ['==', ['get', 'type'], 'line'], ['==', ['get', 'kind'], 'sea']],
        paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.6, 6, 3.4], 'line-dasharray': [0.1, 2] },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      },
      {
        id: 'mark-sel',
        type: 'line',
        source: 'marks',
        filter: ['all', ['==', ['get', 'type'], 'line'], ['get', 'sel']],
        paint: { 'line-color': '#ff2d55', 'line-width': 7, 'line-opacity': 0.35, 'line-blur': 1 },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      },
      {
        id: 'mark-line-labels',
        type: 'symbol',
        source: 'marks',
        minzoom: 3,
        filter: ['all', ['==', ['get', 'type'], 'line'], ['!=', ['get', 'name'], '']],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Semibold Italic'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 8, 13],
          'text-offset': [0, -0.8],
          'symbol-spacing': 320,
        },
        paint: { 'text-color': ['get', 'color'], 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.3 },
      },
      {
        // What a "cut regions" brush has swept so far (it takes the land when released).
        id: 'draw-sweep',
        type: 'line',
        source: 'draw',
        filter: ['==', ['get', 'kind'], 'sweep'],
        paint: { 'line-color': ['coalesce', ['get', 'color'], '#ff2d55'], 'line-width': ['get', 'w'], 'line-opacity': 0.45 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      { id: 'draw-fill', type: 'fill', source: 'draw', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['!=', ['get', 'kind'], 'claim']], paint: { 'fill-color': '#ff2d55', 'fill-opacity': 0.15 } },
      // Draw to claim: the loop under way, in the claiming country's colour.
      { id: 'draw-claim', type: 'fill', source: 'draw', filter: ['==', ['get', 'kind'], 'claim'], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.55 } },
      { id: 'draw-line', type: 'line', source: 'draw', filter: ['all', ['match', ['geometry-type'], ['LineString', 'Polygon'], true, false], ['!=', ['get', 'kind'], 'sweep'], ['!=', ['get', 'kind'], 'claim']], paint: { 'line-color': '#ff2d55', 'line-width': 2.5, 'line-dasharray': [2, 1] } },
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
        // Names placed by hand: seas, lands, mountain ranges, notes.
        id: 'mark-labels',
        type: 'symbol',
        source: 'marks',
        filter: ['==', ['get', 'type'], 'label'],
        layout: {
          'text-field': ['match', ['get', 'kind'], ['sea', 'mountains'], ['upcase', ['get', 'text']], ['get', 'text']],
          'text-font': ['match', ['get', 'kind'], 'sea', ['literal', ['Open Sans Semibold Italic']], 'note', ['literal', ['Open Sans Italic']], ['literal', ['Open Sans Bold']]],
          'text-size': ['interpolate', ['exponential', 1.4], ['zoom'], 1, ['*', ['get', 'size'], 0.55], 4, ['get', 'size'], 8, ['*', ['get', 'size'], 1.7]],
          'text-rotate': ['get', 'angle'],
          'text-letter-spacing': ['match', ['get', 'kind'], 'sea', 0.35, 'mountains', 0.5, 'land', 0.15, 0.02],
          'text-max-width': 12,
          'text-allow-overlap': true,
          'text-rotation-alignment': 'map',
          'text-pitch-alignment': 'viewport',
        },
        paint: {
          'text-color': ['coalesce', ['get', 'color'], ['match', ['get', 'kind'], 'sea', '#3f6f9f', 'mountains', '#6b4a2b', 'note', '#2a3142', '#3a3346']],
          'text-halo-color': ['case', ['get', 'sel'], 'rgba(255,45,85,0.45)', 'rgba(255,255,255,0.7)'],
          'text-halo-width': ['case', ['get', 'sel'], 3, 1.2],
        },
      },
      {
        id: 'mark-pins',
        type: 'symbol',
        source: 'marks',
        filter: ['==', ['get', 'type'], 'pin'],
        layout: {
          'icon-image': ['concat', 'pin-', ['get', 'icon']],
          'icon-anchor': 'bottom',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.85, 6, 1.25],
          'icon-allow-overlap': true,
          'text-allow-overlap': true,
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Semibold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 2, 9, 8, 13],
          'text-anchor': 'top',
          'text-offset': [0, 0.3],
          'text-optional': true,
          'text-max-width': 9,
        },
        paint: {
          'text-color': '#222a38',
          'text-halo-color': ['case', ['get', 'sel'], 'rgba(255,45,85,0.45)', 'rgba(255,255,255,0.85)'],
          'text-halo-width': ['case', ['get', 'sel'], 3, 1.3],
        },
      },
      {
        // Country names bent along the country (atlas style), when curved names are on.
        id: 'country-labels-curved',
        type: 'symbol',
        source: 'country-curves',
        filter: ['>=', ['zoom'], ['get', 'zfit']],
        layout: {
          visibility: 'none',
          'symbol-placement': 'line-center',
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, ['+', 8, ['*', 7, ['get', 's']]], 4, ['+', 11, ['*', 12, ['get', 's']]], 7, ['+', 14, ['*', 16, ['get', 's']]]],
          'text-letter-spacing': 0.28,
          'text-max-angle': 38,
          'text-keep-upright': true,
          'text-padding': 4,
          'symbol-sort-key': ['-', ['get', 's']],
        },
        paint: { 'text-color': '#1b2333', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.6 },
      },
      {
        // With curved names: the flag alone, once the name has moved onto its arc.
        id: 'country-flags',
        type: 'symbol',
        source: 'country-labels',
        filter: ['>=', ['zoom'], ['get', 'zfit']],
        layout: {
          visibility: 'none',
          'icon-image': ['get', 'flag'],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 1, ['+', 0.4, ['*', 0.35, ['get', 's']]], 5, ['+', 0.65, ['*', 0.45, ['get', 's']]]],
          'icon-anchor': 'bottom',
          'icon-offset': [0, -10],
          'icon-padding': 2,
          // The name runs along its arc right under the flag: the flag must not push it away.
          'icon-ignore-placement': true,
          'symbol-sort-key': ['-', ['get', 's']],
        },
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
