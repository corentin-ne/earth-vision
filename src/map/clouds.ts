import * as maplibregl from 'maplibre-gl';
import type { Map as MLMap, MapSourceDataEvent } from 'maplibre-gl';

/** The sources whose tiles pop in visibly while the map moves fast. */
const WATCHED = new Set(['regions', 'borders-country', 'relief', 'dem-tint']);
const LAYER = 'clouds';
/** Loading shorter than this never thickens the clouds: cached tiles come back without a flicker. */
const SHOW_AFTER = 160;

const workers: Worker[] = [];
let nextId = 0;
const waiting = new Map<number, (buf: ArrayBuffer | null) => void>();
const cache = new Map<string, Promise<ArrayBuffer | null>>();

/** A couple of workers paint the tiles side by side, away from the map's own thread. */
function pickWorker(id: number): Worker {
  if (!workers.length) {
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./clouds.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; buf?: ArrayBuffer }>) => {
        waiting.get(e.data.id)?.(e.data.buf ?? null);
        waiting.delete(e.data.id);
      };
      workers.push(w);
    }
  }
  return workers[id % workers.length];
}

function tile(z: number, x: number, y: number): Promise<ArrayBuffer | null> {
  const key = `${z}/${x}/${y}`;
  let p = cache.get(key);
  if (!p) {
    const id = nextId++;
    p = new Promise((res) => waiting.set(id, res));
    pickWorker(id).postMessage({ id, z, x, y });
    cache.set(key, p);
  }
  // Each caller gets its own copy: MapLibre takes the buffer over.
  return p.then((b) => (b ? b.slice(0) : null));
}

let registered = false;
function register() {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol('clouds', async (params) => {
    const m = /clouds:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    const buf = m ? await tile(+m[1], +m[2], +m[3]) : null;
    if (!buf) throw new Error('no cloud tile');
    return { data: buf };
  });
}

/**
 * A deck of soft white clouds drifting over the globe, as the Earth looks from space. Seen whole
 * it is a veil of weather; zoomed in it thins away. While the land underneath is still arriving
 * (a fast pan or zoom) the clouds gather a little, then clear once everything has landed.
 */
export class CloudDeck {
  private pending = new Map<string, number>();
  private boost = 0;
  private raf = 0;
  private last = 0;
  private on = true;
  private base = 1;

  constructor(private map: MLMap) {}

  install(before?: string) {
    register();
    const m = this.map;
    m.addSource(LAYER, { type: 'raster', tiles: ['clouds://{z}/{x}/{y}'], tileSize: 256, maxzoom: 4 });
    m.addLayer(
      { id: LAYER, type: 'raster', source: LAYER, paint: { 'raster-opacity': this.opacity(), 'raster-fade-duration': 600, 'raster-resampling': 'linear' } },
      before && m.getLayer(before) ? before : undefined,
    );
    m.on('sourcedataloading', this.onLoading);
    m.on('sourcedata', this.onLoaded);
    m.on('sourcedataabort', this.onLoaded);
  }

  /** Shows or hides the deck; `strength` dims it for darker looks. */
  configure(on: boolean, strength: number) {
    this.on = on;
    this.base = strength;
    if (this.map.getLayer(LAYER)) {
      this.map.setLayoutProperty(LAYER, 'visibility', on ? 'visible' : 'none');
      this.map.setPaintProperty(LAYER, 'raster-opacity', this.opacity());
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.map.off('sourcedataloading', this.onLoading);
    this.map.off('sourcedata', this.onLoaded);
    this.map.off('sourcedataabort', this.onLoaded);
  }

  /** Thick over the whole globe, gone by street level; `boost` gathers them while loading. */
  private opacity(): maplibregl.ExpressionSpecification {
    const b = this.boost, k = this.base;
    return ['interpolate', ['linear'], ['zoom'], 0, k * (0.72 + 0.25 * b), 2.5, k * (0.55 + 0.35 * b), 4.5, k * (0.18 + 0.45 * b), 6, k * (0.04 + 0.4 * b), 9, k * 0.25 * b, 11, 0];
  }

  private key(e: MapSourceDataEvent) {
    if (!e.sourceId || !WATCHED.has(e.sourceId)) return null;
    const c = (e as unknown as { coord?: { key?: string | number } }).coord;
    return c?.key != null ? `${e.sourceId}:${c.key}` : null;
  }

  private onLoading = (e: MapSourceDataEvent) => {
    const k = this.key(e);
    if (!k) return;
    this.pending.set(k, performance.now());
    this.wake();
  };

  private onLoaded = (e: MapSourceDataEvent) => {
    const k = this.key(e);
    if (k && this.pending.delete(k)) this.wake();
  };

  private wake() {
    if (this.raf || !this.on) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.step);
  }

  private step = (now: number) => {
    this.raf = 0;
    const dt = Math.min(100, now - this.last);
    this.last = now;
    let slow = false;
    for (const [k, t] of this.pending) {
      // A tile that never reports back lets the clouds go after a while.
      if (now - t > 5000) this.pending.delete(k);
      else if (now - t > SHOW_AFTER) slow = true;
    }
    const target = slow ? 1 : 0;
    const prev = this.boost;
    this.boost = target > prev ? Math.min(1, prev + dt / 350) : Math.max(0, prev - dt / 900);
    if (this.boost !== prev && this.map.getLayer(LAYER)) this.map.setPaintProperty(LAYER, 'raster-opacity', this.opacity());
    if (this.pending.size || this.boost > 0) this.raf = requestAnimationFrame(this.step);
  };
}
