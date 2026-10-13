import { useEffect, useRef } from 'react';
import { mapCtl } from '../map/controller';
import { asset, LOOKS } from '../map/style';
import { useWorld } from '../world/store';

/** Pixels across the drawn sphere: it is scaled with CSS, so this only sets its sharpness. */
const RES = 300;
/** How long the little globe takes to grow into the real one once the map is ready. */
export const HANDOFF_MS = 900;
const DEG = Math.PI / 180;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpLng = (a: number, b: number, t: number) => a + ((((b - a + 540) % 360) - 180) * t);

/** Where and how big the real globe stands on screen, and which way it faces. */
function mapGlobe(): { x: number; y: number; r: number; lng: number; lat: number; bearing: number } | null {
  const m = mapCtl?.map;
  if (!m) return null;
  const el = m.getContainer();
  const box = el.getBoundingClientRect();
  const c = m.getCenter();
  const p = m.project(c);
  if (!useWorld.getState().globe) return { x: box.left + p.x, y: box.top + p.y, r: Math.hypot(box.width, box.height), lng: c.lng, lat: c.lat, bearing: m.getBearing() };
  // MapLibre's globe: a world 512·2^zoom pixels around at the centre's latitude, seen in perspective.
  const R = (512 * 2 ** m.getZoom()) / (2 * Math.PI) / Math.max(0.05, Math.cos(c.lat * DEG));
  const cam = (box.height / 2) / Math.tan((((m as unknown as { transform?: { fov?: number } }).transform?.fov ?? 36.87) * DEG) / 2);
  const r = cam * Math.tan(Math.asin(Math.min(0.999, R / (cam + R))));
  return { x: box.left + p.x, y: box.top + p.y, r, lng: c.lng, lat: c.lat, bearing: m.getBearing() };
}

/**
 * The loading screen's globe: the real relief of the Earth on a turning sphere, lit from the side,
 * with its atmosphere. When the map is ready it swings round to the map's view and grows into the
 * real globe, which takes over under it.
 */
export function BootGlobe({ ready }: { ready: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    const canvas = cv.current!;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) return;
    canvas.width = canvas.height = RES;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ocean = hex(LOOKS[useWorld.getState().mapStyle]?.ocean ?? '#c4def0');
    const night = useWorld.getState().mapStyle === 'night';

    // The sphere's geometry and light, worked out once per pixel.
    const n = RES * RES;
    const nx = new Float32Array(n), ny = new Float32Array(n), nz = new Float32Array(n), light = new Float32Array(n);
    const inside = new Uint8Array(n);
    const lx = -0.55, ly = 0.45, lz = 0.7; // from the upper left, a little in front
    for (let j = 0; j < RES; j++)
      for (let i = 0; i < RES; i++) {
        const x = ((i + 0.5) / RES) * 2 - 1, y = 1 - ((j + 0.5) / RES) * 2;
        const d = x * x + y * y;
        const k = j * RES + i;
        if (d > 1) continue;
        const z = Math.sqrt(1 - d);
        inside[k] = d > 0.985 ? 2 : 1; // the rim is anti-aliased
        nx[k] = x; ny[k] = y; nz[k] = z;
        const dot = Math.max(0, x * lx + y * ly + z * lz);
        light[k] = 0.32 + 0.78 * dot ** 0.8;
      }

    let tex: ImageData | null = null;
    const img = new Image();
    img.onload = () => {
      const c2 = document.createElement('canvas');
      c2.width = img.width;
      c2.height = img.height;
      const g2 = c2.getContext('2d')!;
      g2.drawImage(img, 0, 0);
      tex = g2.getImageData(0, 0, img.width, img.height);
    };
    img.src = asset('tiles/relief/0/0/0.webp');

    const out = ctx.createImageData(RES, RES);
    const px = out.data;
    const paint = (lng0: number, lat0: number) => {
      const sinL = Math.sin(lat0 * DEG), cosL = Math.cos(lat0 * DEG);
      const T = tex;
      const tw = T?.width ?? 1, th = T?.height ?? 1;
      for (let k = 0; k < n; k++) {
        const o = k * 4;
        if (!inside[k]) {
          px[o + 3] = 0;
          continue;
        }
        const x = nx[k], y = ny[k], z = nz[k];
        // Turn the view direction back onto the Earth: latitude and longitude under this pixel.
        const wy = y * cosL + z * sinL;
        const wz = z * cosL - y * sinL;
        const lat = Math.asin(wy);
        const lng = lng0 * DEG + Math.atan2(x, wz);
        let r = ocean[0], g = ocean[1], b = ocean[2];
        // Deeper water away from the light.
        const sea = 0.78 + 0.22 * z;
        r *= sea; g *= sea; b *= sea;
        if (T) {
          const u = (((lng / (2 * Math.PI) + 0.5) % 1) + 1) % 1;
          const lc = Math.max(-1.484, Math.min(1.484, lat));
          const v = 0.5 - Math.log(Math.tan(Math.PI / 4 + lc / 2)) / (2 * Math.PI);
          const ti = ((Math.min(th - 1, (v * th) | 0) * tw + Math.min(tw - 1, (u * tw) | 0)) * 4);
          const a = T.data[ti + 3] / 255;
          if (a > 0) {
            // A touch richer than the pale atlas relief.
            const tr = T.data[ti], tg = T.data[ti + 1], tb = T.data[ti + 2];
            const m = (tr + tg + tb) / 3;
            const sat = 1.45;
            r = lerp(r, m + (tr - m) * sat - 14, a);
            g = lerp(g, m + (tg - m) * sat - 10, a);
            b = lerp(b, m + (tb - m) * sat - 18, a);
          }
        }
        let l = light[k];
        if (night) l *= 0.55;
        // A soft glint of the sun on the water.
        const spec = Math.max(0, x * -0.42 + y * 0.38 + z * 0.82) ** 40 * 32;
        px[o] = r * l + spec;
        px[o + 1] = g * l + spec;
        px[o + 2] = b * l + spec;
        px[o + 3] = inside[k] === 2 ? 170 : 255;
      }
      ctx.putImageData(out, 0, 0);
    };

    // Before the hand-off: a small globe in the middle, turning; then a flight into the map's globe.
    let raf = 0;
    let lng = 10, lat = 18;
    let from: { x: number; y: number; r: number; lng: number; lat: number; bearing: number } | null = null;
    let to: ReturnType<typeof mapGlobe> = null;
    let t0 = 0;
    let last = performance.now();
    const place = (x: number, y: number, r: number, bearing: number, opacity: number) => {
      const w = wrap.current;
      if (!w) return;
      w.style.transform = `translate(${x - r}px, ${y - r}px) rotate(${-bearing}deg)`;
      w.style.width = w.style.height = `${2 * r}px`;
      w.style.opacity = String(opacity);
      w.style.setProperty('--glow', `${Math.max(14, r * 0.28)}px`);
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const W = window.innerWidth, H = window.innerHeight;
      const r0 = Math.min(110, Math.min(W, H) * 0.2);
      if (!readyRef.current) {
        if (!reduced) lng -= dt * 24;
        paint(lng, lat);
        place(W / 2, H / 2 - 30, r0, 0, 1);
        return;
      }
      if (!from) {
        from = { x: W / 2, y: H / 2 - 30, r: r0, lng, lat, bearing: 0 };
        to = mapGlobe() ?? { x: W / 2, y: H / 2, r: Math.hypot(W, H), lng: lng - 30, lat: 10, bearing: 0 };
        t0 = now;
      }
      const t = reduced ? 1 : Math.min(1, (now - t0) / HANDOFF_MS);
      const e = easeInOut(t);
      paint(lerpLng(from.lng, to!.lng, e), lerp(from.lat, to!.lat, e));
      // It fades out over the last part, as the real globe fades in beneath it.
      place(lerp(from.x, to!.x, e), lerp(from.y, to!.y, e), lerp(from.r, to!.r, e), lerp(from.bearing, to!.bearing, e), t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45);
      if (t >= 1) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="boot-sphere" ref={wrap} aria-hidden>
      <canvas ref={cv} />
    </div>
  );
}

function hex(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return [60, 110, 170];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
