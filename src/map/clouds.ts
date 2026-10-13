import type { GeoJSONSource, Map as MLMap, MapSourceDataEvent } from 'maplibre-gl';
import type { Feature, Polygon } from 'geojson';

/** The sources whose tiles pop in visibly while the map moves fast. */
const WATCHED = new Set(['regions', 'borders-country', 'relief', 'dem-tint']);
/** A tile loading for less than this never shows clouds: cached tiles come back without a flicker. */
const SHOW_AFTER = 140;
const FADE_IN = 260;
const FADE_OUT = 650;
/** A tile that never reports back (an error, a dropped request) lets its clouds go after this. */
const GIVE_UP = 6000;
const LAYER = 'loading-clouds';
const IMAGE = 'cloud-veil';

interface Patch {
  id: number;
  z: number;
  x: number;
  y: number;
  /** Tiles of the watched sources still loading here. */
  loading: number;
  since: number;
  alpha: number;
  shown: boolean;
}

/**
 * Soft clouds drift over the parts of the map whose tiles are still on their way, and dissolve
 * as each one lands: a fast pan or zoom no longer shows the land arriving square by square.
 */
export class LoadingClouds {
  private patches = new Map<number, Patch>();
  private raf = 0;
  private last = 0;
  private dirty = false;

  constructor(private map: MLMap) {}

  /** Adds the layer just under `before` (the first layer the clouds should not cover). */
  install(before?: string) {
    const m = this.map;
    if (!m.hasImage(IMAGE)) m.addImage(IMAGE, cloudImage(), { pixelRatio: 2 });
    m.addSource(LAYER, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, tolerance: 1 });
    m.addLayer(
      {
        id: LAYER,
        type: 'fill',
        source: LAYER,
        paint: { 'fill-pattern': IMAGE, 'fill-opacity': ['coalesce', ['feature-state', 'a'], 0], 'fill-antialias': false },
      },
      before && m.getLayer(before) ? before : undefined,
    );
    m.on('sourcedataloading', this.onLoading);
    m.on('sourcedata', this.onLoaded);
    m.on('sourcedataabort', this.onLoaded);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.map.off('sourcedataloading', this.onLoading);
    this.map.off('sourcedata', this.onLoaded);
    this.map.off('sourcedataabort', this.onLoaded);
  }

  private onLoading = (e: MapSourceDataEvent) => {
    const t = tileOf(e);
    if (!t) return;
    const id = keyOf(t.z, t.x, t.y);
    const p = this.patches.get(id);
    if (p) p.loading++;
    else this.patches.set(id, { id, ...t, loading: 1, since: performance.now(), alpha: 0, shown: false });
    this.wake();
  };

  private onLoaded = (e: MapSourceDataEvent) => {
    const t = tileOf(e);
    if (!t) return;
    const p = this.patches.get(keyOf(t.z, t.x, t.y));
    if (!p) return;
    p.loading = Math.max(0, p.loading - 1);
    this.wake();
  };

  private wake() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.step);
  }

  private step = (now: number) => {
    this.raf = 0;
    const dt = Math.min(100, now - this.last);
    this.last = now;
    const m = this.map;
    for (const p of [...this.patches.values()]) {
      if (p.loading && now - p.since > GIVE_UP) p.loading = 0;
      const want = p.loading > 0 && now - p.since > SHOW_AFTER;
      if (want && !p.shown) {
        p.shown = true;
        this.dirty = true;
      }
      if (!p.shown) {
        if (!p.loading) this.patches.delete(p.id);
        continue;
      }
      const a = want ? Math.min(1, p.alpha + dt / FADE_IN) : Math.max(0, p.alpha - dt / FADE_OUT);
      if (a !== p.alpha) {
        p.alpha = a;
        m.setFeatureState({ source: LAYER, id: p.id }, { a: ease(a) * 0.92 });
      }
      if (!want && a === 0) {
        this.patches.delete(p.id);
        m.removeFeatureState({ source: LAYER, id: p.id });
        this.dirty = true;
      }
    }
    if (this.dirty) {
      this.dirty = false;
      const features = [...this.patches.values()].filter((p) => p.shown).map(tileFeature);
      (m.getSource(LAYER) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
    }
    if (this.patches.size) this.raf = requestAnimationFrame(this.step);
  };
}

const ease = (t: number) => t * t * (3 - 2 * t);

function tileOf(e: MapSourceDataEvent): { z: number; x: number; y: number } | null {
  if (!e.sourceId || !WATCHED.has(e.sourceId)) return null;
  const c = (e as unknown as { coord?: { canonical?: { z: number; x: number; y: number } } }).coord?.canonical;
  if (!c) return null;
  return { z: c.z, x: c.x, y: c.y };
}

/** A unique number per tile: all tiles of lower zooms first, then this zoom's row by row. */
function keyOf(z: number, x: number, y: number) {
  return (4 ** z - 1) / 3 + y * 2 ** z + x;
}

function tileFeature(p: Patch): Feature<Polygon> {
  const n = 2 ** p.z;
  const lng = (x: number) => (x / n) * 360 - 180;
  const lat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  // A little wider than the tile, so neighbouring patches melt into each other.
  const pad = 0.04;
  const w = lng(p.x - pad), e = lng(p.x + 1 + pad);
  const nth = lat(Math.max(0, p.y - pad)), s = lat(Math.min(n, p.y + 1 + pad));
  // Points along each edge, so the patch follows the curve of the globe.
  const ring: [number, number][] = [];
  const k = 8;
  for (let i = 0; i <= k; i++) ring.push([w + ((e - w) * i) / k, nth]);
  for (let i = 1; i <= k; i++) ring.push([e, nth + ((s - nth) * i) / k]);
  for (let i = 1; i <= k; i++) ring.push([e - ((e - w) * i) / k, s]);
  for (let i = 1; i < k; i++) ring.push([w, s - ((s - nth) * i) / k]);
  ring.push(ring[0]);
  return { type: 'Feature', id: p.id, properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/** A seamless square of soft, layered clouds (tileable value noise), white with a faint blue shade. */
function cloudImage(): { width: number; height: number; data: Uint8Array } {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const octave = (cells: number) => {
    const g = Array.from({ length: cells * cells }, rnd);
    return (x: number, y: number) => {
      const fx = (x / S) * cells, fy = (y / S) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => g[((j % cells) * cells + (i % cells)) % g.length];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const os = [octave(4), octave(8), octave(16), octave(32)];
  const ws = [0.5, 0.27, 0.15, 0.08];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (let i = 0; i < os.length; i++) v += os[i](x, y) * ws[i];
      // Mostly cloud, with brighter billows and thinner gaps.
      const c = Math.min(1, Math.max(0, (v - 0.22) * 1.9));
      const o = (y * S + x) * 4;
      data[o] = 236 + 19 * c;
      data[o + 1] = 242 + 13 * c;
      data[o + 2] = 250 + 5 * c;
      data[o + 3] = Math.round(255 * (0.72 + 0.28 * c));
    }
  return { width: S, height: S, data };
}
