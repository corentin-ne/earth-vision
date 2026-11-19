// Animated winds and ocean currents: particles drifting with a vector field, leaving fading
// trails, drawn on a canvas laid over the map. Winds come from a global grid of mean surface
// winds (public/data/winds.json); currents from the great named currents drawn as lines
// (public/data/currents.json), turned into a field that flows along them.
import type { Map as MLMap } from 'maplibre-gl';
import type { FeatureCollection, LineString } from 'geojson';
import { asset } from './style';

export interface WindGrid {
  nx: number;
  ny: number;
  /** Longitude of the first column, latitude of the first row (the northernmost). */
  lo1: number;
  la1: number;
  dx: number;
  dy: number;
  u: number[];
  v: number[];
}

/** A vector field on a regular lng/lat grid: speed east (u) and north (v), plus a tag per cell. */
export class Field {
  constructor(
    readonly nx: number,
    readonly ny: number,
    readonly lo1: number,
    readonly la1: number,
    readonly dx: number,
    readonly dy: number,
    readonly u: Float32Array,
    readonly v: Float32Array,
    /** Currents: +1 warm, -1 cold, 0 neutral (winds: unused). */
    readonly tag?: Int8Array,
  ) {}

  /** Bilinear sample at a point; null outside the grid. */
  at(lng: number, lat: number): [number, number, number] | null {
    let x = (lng - this.lo1) / this.dx;
    x = ((x % this.nx) + this.nx) % this.nx;
    const y = (this.la1 - lat) / this.dy;
    if (y < 0 || y > this.ny - 1) return null;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = (x0 + 1) % this.nx;
    const y1 = Math.min(this.ny - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const i00 = y0 * this.nx + x0;
    const i10 = y0 * this.nx + x1;
    const i01 = y1 * this.nx + x0;
    const i11 = y1 * this.nx + x1;
    const lerp = (a: Float32Array) => (a[i00] * (1 - fx) + a[i10] * fx) * (1 - fy) + (a[i01] * (1 - fx) + a[i11] * fx) * fy;
    const tag = this.tag ? this.tag[Math.round(y) * this.nx + (Math.round(x) % this.nx)] : 0;
    return [lerp(this.u), lerp(this.v), tag];
  }
}

export function windField(g: WindGrid): Field {
  return new Field(g.nx, g.ny, g.lo1, g.la1, g.dx, g.dy, Float32Array.from(g.u), Float32Array.from(g.v));
}

/**
 * A field that flows along the current lines: every cell within reach of a line takes the
 * direction of the nearest stretch of it, strongest on the line and fading out over `reach`.
 */
export function currentField(fc: FeatureCollection<LineString, { temp?: string; strength?: number }>, res = 0.5, reach = 2.2): Field {
  const nx = Math.round(360 / res);
  const ny = Math.round(170 / res) + 1;
  const la1 = 85;
  const u = new Float32Array(nx * ny);
  const v = new Float32Array(nx * ny);
  const best = new Float32Array(nx * ny).fill(Infinity);
  const tag = new Int8Array(nx * ny);
  for (const f of fc.features) {
    const c = f.geometry?.coordinates;
    if (!c || c.length < 2) continue;
    const speed = 0.25 + 0.25 * (f.properties?.strength ?? 2);
    const t = f.properties?.temp === 'warm' ? 1 : f.properties?.temp === 'cold' ? -1 : 0;
    for (let i = 1; i < c.length; i++) {
      const [ax, ay] = c[i - 1];
      let [bx, by] = c[i];
      if (Math.abs(bx - ax) > 180) bx += bx < ax ? 360 : -360;
      const k = Math.cos((((ay + by) / 2) * Math.PI) / 180);
      const ex = (bx - ax) * k;
      const ey = by - ay;
      const len = Math.hypot(ex, ey) || 1;
      const [dx, dy] = [ex / len, ey / len];
      const minX = Math.min(ax, bx) - reach / Math.max(0.2, k);
      const maxX = Math.max(ax, bx) + reach / Math.max(0.2, k);
      const minY = Math.min(ay, by) - reach;
      const maxY = Math.max(ay, by) + reach;
      for (let gy = Math.max(0, Math.floor((la1 - maxY) / res)); gy <= Math.min(ny - 1, Math.ceil((la1 - minY) / res)); gy++) {
        const lat = la1 - gy * res;
        for (let gxr = Math.floor((minX + 180) / res); gxr <= Math.ceil((maxX + 180) / res); gxr++) {
          const lng = gxr * res - 180;
          // Distance from the cell to the segment, in degrees of latitude.
          const px = (lng - ax) * k;
          const py = lat - ay;
          const s = Math.max(0, Math.min(len, px * dx + py * dy));
          const d = Math.hypot(px - dx * s, py - dy * s);
          if (d > reach) continue;
          const gx = ((gxr % nx) + nx) % nx;
          const idx = gy * nx + gx;
          if (d >= best[idx]) continue;
          best[idx] = d;
          const w = speed * (1 - (d / reach) ** 2);
          u[idx] = dx * w;
          v[idx] = dy * w;
          tag[idx] = t;
        }
      }
    }
  }
  return new Field(nx, ny, -180, la1, res, res, u, v, tag);
}

const cache = new Map<string, Promise<Field>>();
export function loadField(kind: 'winds' | 'currents'): Promise<Field> {
  let p = cache.get(kind);
  if (!p) {
    p = fetch(asset(`data/${kind}.json`))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => (kind === 'winds' ? windField(d as WindGrid) : currentField(d)));
    p.catch(() => cache.delete(kind));
    cache.set(kind, p);
  }
  return p;
}

interface Particle {
  lng: number;
  lat: number;
  age: number;
  /** Where it was drawn last frame (screen px), or null after a jump. */
  x: number | null;
  y: number | null;
}

export interface FlowStyle {
  /** Trail colour for winds, as "r,g,b". */
  wind: string;
  warm: string;
  cold: string;
  neutral: string;
}

/**
 * Draws one or two particle systems (winds, currents) on a canvas over the map. Trails fade
 * frame by frame; any camera move wipes them so nothing smears across the screen.
 */
export class FlowRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private systems: { kind: 'winds' | 'currents'; field: Field; ps: Particle[] }[] = [];
  private moving = false;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  style: FlowStyle = { wind: '255,255,255', warm: '232,84,60', cold: '46,123,214', neutral: '90,120,150' };

  constructor(private map: MLMap) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'flow-canvas';
    map.getCanvasContainer().appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    map.on('resize', this.resize);
    map.on('movestart', this.onMoveStart);
    map.on('moveend', this.onMoveEnd);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private resize = () => {
    const c = this.map.getContainer();
    this.canvas.width = Math.round(c.clientWidth * this.dpr);
    this.canvas.height = Math.round(c.clientHeight * this.dpr);
    this.canvas.style.width = c.clientWidth + 'px';
    this.canvas.style.height = c.clientHeight + 'px';
    this.reseedAll();
  };

  private onMoveStart = () => {
    this.moving = true;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  };

  private onMoveEnd = () => {
    this.moving = false;
    this.reseedAll();
  };

  private onVisibility = () => {
    if (document.hidden) cancelAnimationFrame(this.raf);
    else if (this.systems.length) this.loop();
  };

  /** Turns each system on or off (loading its data the first time). */
  async set(kind: 'winds' | 'currents', on: boolean) {
    const has = this.systems.find((s) => s.kind === kind);
    if (!on) {
      if (has) this.systems = this.systems.filter((s) => s !== has);
      if (!this.systems.length) this.stop();
      return;
    }
    if (has) return;
    const field = await loadField(kind);
    if (this.systems.some((s) => s.kind === kind)) return;
    const n = Math.round((kind === 'winds' ? 2600 : 2200) * (window.innerWidth < 760 ? 0.5 : 1));
    const sys = { kind, field, ps: [] as Particle[] };
    for (let i = 0; i < n; i++) sys.ps.push(this.spawn(sys.field, kind, { lng: 0, lat: 0, age: 0, x: null, y: null }, true));
    this.systems.push(sys);
    if (this.systems.length === 1) this.loop();
  }

  private reseedAll() {
    for (const s of this.systems) for (const p of s.ps) this.spawn(s.field, s.kind, p, true);
  }

  /** Puts a particle back somewhere in view (currents: only where a current flows). */
  private spawn(field: Field, kind: string, p: Particle, randomAge = false): Particle {
    const b = this.map.getBounds();
    let west = b.getWest();
    let east = b.getEast();
    const south = Math.max(-80, b.getSouth());
    const north = Math.min(80, b.getNorth());
    if (east - west > 360 || this.map.getZoom() < 2) [west, east] = [-180, 180];
    for (let tries = 0; tries < 12; tries++) {
      const lng = west + Math.random() * (east - west);
      const lat = south + Math.random() * (north - south);
      const f = field.at(lng, lat);
      if (!f) continue;
      if (kind === 'currents' && Math.hypot(f[0], f[1]) < 0.08 && tries < 11) continue;
      p.lng = lng;
      p.lat = lat;
      break;
    }
    p.age = randomAge ? Math.floor(Math.random() * 80) : 0;
    p.x = p.y = null;
    return p;
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    const tick = (t: number) => {
      this.raf = requestAnimationFrame(tick);
      if (t - this.last < 33) return; // ~30 fps is plenty for drifting trails
      this.last = t;
      if (!this.moving) this.frame();
    };
    this.raf = requestAnimationFrame(tick);
  };

  private frame() {
    const { ctx, canvas, map } = this;
    // Fade what is there: trails shorten by a few percent each frame.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    const zoom = map.getZoom();
    const centre = map.getCenter();
    const globe = map.getProjection()?.type === 'globe';
    const r = Math.PI / 180;
    const sinC = Math.sin(centre.lat * r);
    const cosC = Math.cos(centre.lat * r);
    // Degrees per frame per unit of speed: the same pace on screen at every zoom.
    const step = 0.9 / 2 ** zoom;
    ctx.lineCap = 'round';
    for (const s of this.systems) {
      const wind = s.kind === 'winds';
      ctx.lineWidth = (wind ? 1.1 : 1.6) * this.dpr;
      const k = wind ? step * 0.3 : step * 2.4;
      for (const p of s.ps) {
        const f = s.field.at(p.lng, p.lat);
        p.age++;
        if (!f || p.age > 110 || (s.kind === 'currents' && Math.hypot(f[0], f[1]) < 0.02)) {
          this.spawn(s.field, s.kind, p);
          continue;
        }
        const [u, v, tag] = f;
        const cosLat = Math.max(0.15, Math.cos(p.lat * r));
        p.lng += (u * k) / cosLat;
        p.lat += v * k;
        if (p.lng > 180) p.lng -= 360;
        if (p.lng < -180) p.lng += 360;
        if (globe) {
          const cos = sinC * Math.sin(p.lat * r) + cosC * Math.cos(p.lat * r) * Math.cos((p.lng - centre.lng) * r);
          if (cos < 0.12) {
            p.x = p.y = null;
            continue;
          }
        }
        const q = map.project([p.lng, p.lat]);
        const x = q.x * this.dpr;
        const y = q.y * this.dpr;
        if (p.x != null && p.y != null && Math.abs(x - p.x) < 60 && Math.abs(y - p.y) < 60) {
          const speed = Math.hypot(u, v);
          const a = wind ? Math.min(0.9, 0.25 + speed / 14) : Math.min(0.95, 0.35 + speed);
          const rgb = wind ? this.style.wind : tag > 0 ? this.style.warm : tag < 0 ? this.style.cold : this.style.neutral;
          ctx.strokeStyle = `rgba(${rgb},${a})`;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        p.x = x;
        p.y = y;
      }
    }
  }

  private stop() {
    cancelAnimationFrame(this.raf);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  destroy() {
    this.stop();
    this.map.off('resize', this.resize);
    this.map.off('movestart', this.onMoveStart);
    this.map.off('moveend', this.onMoveEnd);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.remove();
  }
}
