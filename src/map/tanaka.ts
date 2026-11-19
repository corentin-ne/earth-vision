// Tanaka's illuminated contours: contour lines computed on the fly from the bundled elevation
// tiles (maplibre-contour, in a worker), each drawn twice — a light edge toward the sun in the
// north-west and a dark edge away from it — so the relief reads as lit terraces.
import * as maplibregl from 'maplibre-gl';
import type { Map as MLMap } from 'maplibre-gl';
import mlcontour from 'maplibre-contour';
import { asset } from './style';

const SOURCE = 'tanaka';
export const TANAKA_LAYERS = ['tanaka-shadow', 'tanaka-light', 'tanaka-line'];

let dem: InstanceType<typeof mlcontour.DemSource> | null = null;

function demSource() {
  if (!dem) {
    dem = new mlcontour.DemSource({ url: asset('tiles/dem/{z}/{x}/{y}.webp'), encoding: 'terrarium', maxzoom: 6, worker: true, cacheSize: 80 });
    dem.setupMaplibre(maplibregl as never);
  }
  return dem;
}

/** Adds the contour source and its three line layers (once), under `before`. */
export function ensureTanaka(map: MLMap, before: string) {
  if (map.getSource(SOURCE)) return;
  const url = demSource().contourProtocolUrl({
    // Zoom → [every line, every major line] in metres: coarse terraces far out, finer close up.
    thresholds: { 1: [500, 1000], 4: [300, 900], 6: [200, 1000], 8: [100, 500], 10: [50, 250] },
    contourLayer: 'contours',
    elevationKey: 'ele',
    levelKey: 'level',
    extent: 4096,
    buffer: 1,
  });
  map.addSource(SOURCE, { type: 'vector', tiles: [url], maxzoom: 11 });
  const width = ['interpolate', ['linear'], ['zoom'], 1, 0.7, 6, 1.3, 10, 1.8] as never;
  const below = map.getLayer(before) ? before : undefined;
  map.addLayer(
    {
      id: 'tanaka-shadow',
      type: 'line',
      source: SOURCE,
      'source-layer': 'contours',
      paint: { 'line-color': 'rgba(30,24,40,0.55)', 'line-width': width, 'line-translate': [0.9, 0.9], 'line-blur': 0.4 },
      layout: { 'line-join': 'round' },
    },
    below,
  );
  map.addLayer(
    {
      id: 'tanaka-light',
      type: 'line',
      source: SOURCE,
      'source-layer': 'contours',
      paint: { 'line-color': 'rgba(255,252,240,0.8)', 'line-width': width, 'line-translate': [-0.9, -0.9], 'line-blur': 0.4 },
      layout: { 'line-join': 'round' },
    },
    below,
  );
  map.addLayer(
    {
      // The contour itself, a hair darker on the major levels.
      id: 'tanaka-line',
      type: 'line',
      source: SOURCE,
      'source-layer': 'contours',
      paint: { 'line-color': ['match', ['get', 'level'], 1, 'rgba(60,45,30,0.35)', 'rgba(60,45,30,0.18)'], 'line-width': 0.5 },
    },
    below,
  );
}
