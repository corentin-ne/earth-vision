import { useEffect, useRef, useState } from 'react';
import { mapCtl } from '../map/controller';
import { useWorld } from '../world/store';

// ── Space around the globe ───────────────────────────────────────────────────

const DEG = Math.PI / 180;
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Where the sun and the moon stand overhead right now (longitude, latitude), and the moon's phase (0 new → 0.5 full). */
function skyNow(t = Date.now()) {
  const days = t / 86_400_000 - 10_957.5; // days since J2000
  const g = (357.529 + 0.98560028 * days) * DEG;
  const q = 280.459 + 0.98564736 * days;
  const sunEcl = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const decl = Math.asin(Math.sin(23.44 * DEG) * Math.sin(sunEcl)) / DEG;
  const utcH = (t / 3_600_000) % 24;
  const sunLng = wrap(-15 * (utcH - 12));
  const phase = ((((t / 86_400_000 - 10_962.77) / 29.530588) % 1) + 1) % 1; // from a known new moon
  const moonLng = wrap(sunLng - phase * 360);
  return { sun: [sunLng, decl] as const, moon: [moonLng, 5 * Math.sin(phase * 2 * Math.PI)] as const, phase };
}

interface Star {
  /** Position on the sky, as a longitude and latitude. */
  lng: number;
  lat: number;
  r: number;
  a: number;
  tw: number;
  hue: number;
}

function makeStars(n: number): Star[] {
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, () => {
    const big = rnd() < 0.08;
    return {
      lng: rnd() * 360 - 180,
      lat: Math.asin(rnd() * 2 - 1) / DEG,
      r: big ? 0.9 + rnd() * 0.7 : 0.35 + rnd() * 0.5,
      a: big ? 0.55 + rnd() * 0.35 : 0.18 + rnd() * 0.4,
      tw: rnd() * Math.PI * 2,
      hue: rnd(),
    };
  });
}

/**
 * Deep space behind the 3D globe: faint, slowly twinkling stars that turn with the view, the sun
 * where it really shines on the Earth right now, and the moon in its real phase. Drawn behind the
 * map, so the globe itself hides whatever is on its far side.
 */
export function SpaceBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  const globe = useWorld((s) => s.globe);
  useEffect(() => {
    if (!globe) return;
    const cv = ref.current!;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stars = makeStars(window.innerWidth < 760 ? 220 : 420);
    let raf = 0;
    let lastDraw = 0;
    let moved = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      cv.width = Math.round(cv.clientWidth * dpr);
      cv.height = Math.round(cv.clientHeight * dpr);
      moved = true;
    };
    resize();
    window.addEventListener('resize', resize);
    const onMove = () => (moved = true);
    let bound: typeof mapCtl = null;
    const bind = () => {
      if (bound === mapCtl) return;
      bound?.map.off('move', onMove);
      bound = mapCtl;
      bound?.map.on('move', onMove);
    };

    // Per star, once: its direction's sines, and its colour (stars are drawn grouped by colour).
    const colorOf = (s: Star) => (s.hue < 0.15 ? '#ffd9b0' : s.hue > 0.85 ? '#bcd4ff' : '#eef3ff');
    stars.sort((a, b) => colorOf(a).localeCompare(colorOf(b)));
    const N = stars.length;
    const sLat = new Float64Array(N), cLat = new Float64Array(N), sLng = new Float64Array(N), cLng = new Float64Array(N);
    stars.forEach((s, i) => {
      sLat[i] = Math.sin(s.lat * DEG);
      cLat[i] = Math.cos(s.lat * DEG);
      sLng[i] = Math.sin(s.lng * DEG);
      cLng[i] = Math.cos(s.lng * DEG);
    });
    // Where each star stands on screen, worked out again only when the view moves.
    const sx = new Float32Array(N), sy = new Float32Array(N);
    const onScreen = new Uint8Array(N);
    let sky = skyNow();
    let skyAt = 0;
    let blank = false;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      const viewMoved = moved;
      // Twinkling needs ~20 frames a second at most; moving the map redraws at once.
      if (!viewMoved && (reduced || now - lastDraw < 50)) return;
      moved = false;
      lastDraw = now;
      bind();
      const m = mapCtl?.map;
      const c = m?.getCenter() ?? { lng: 10, lat: 30 };
      const bearing = (m?.getBearing() ?? 0) * DEG;
      const zoom = m?.getZoom() ?? 1.6;
      const W = cv.width, H = cv.height;
      const cx = W / 2, cy = H / 2;
      // Zoomed in, the globe covers the whole screen and hides the sky: nothing to draw.
      if ((512 * 2 ** zoom * dpr) / (2 * Math.PI) >= Math.hypot(W, H) / 2) {
        if (!blank) ctx.clearRect(0, 0, W, H);
        blank = true;
        return;
      }
      blank = false;
      // The sky is looked at from just behind the globe: the same rotation as the map.
      const lat0 = c.lat * DEG;
      const sinL = Math.sin(lat0), cosL = Math.cos(lat0);
      const sinC = Math.sin(c.lng * DEG), cosC = Math.cos(c.lng * DEG);
      const sinB = Math.sin(bearing), cosB = Math.cos(bearing);
      const scale = Math.max(W, H) * 0.62;
      // A direction (its sines) to the screen.
      let pz = 0;
      const toScreen = (sp: number, cp: number, sl: number, clng: number, out: { x: number; y: number }) => {
        const sinl = sl * cosC - clng * sinC, cosl = clng * cosC + sl * sinC;
        const x = cp * sinl;
        const y = cosL * sp - sinL * cp * cosl;
        const z = sinL * sp + cosL * cp * cosl;
        // Spread the whole sphere around the globe (a fisheye), so every direction has its place.
        const k = scale * (1.25 - 0.55 * z);
        const rx = x * k, ry = -y * k;
        out.x = cx + rx * cosB - ry * sinB;
        out.y = cy + rx * sinB + ry * cosB;
        pz = z;
      };
      const pt = { x: 0, y: 0 };
      const project = (lng: number, lat: number) => {
        toScreen(Math.sin(lat * DEG), Math.cos(lat * DEG), Math.sin(lng * DEG), Math.cos(lng * DEG), pt);
        return { x: pt.x, y: pt.y, z: pz };
      };

      ctx.clearRect(0, 0, W, H);
      // Stars, fading away as the view closes in (the sky is mostly hidden by then anyway).
      const fade = Math.max(0, Math.min(1, (4.5 - zoom) / 2.5));
      if (fade > 0) {
        if (viewMoved) {
          for (let i = 0; i < N; i++) {
            toScreen(sLat[i], cLat[i], sLng[i], cLng[i], pt);
            sx[i] = pt.x;
            sy[i] = pt.y;
            onScreen[i] = pt.x < -4 || pt.y < -4 || pt.x > W + 4 || pt.y > H + 4 ? 0 : 1;
          }
        }
        const t = now / 1000;
        let fill = '';
        for (let i = 0; i < N; i++) {
          if (!onScreen[i]) continue;
          const s = stars[i];
          const tw = reduced ? 1 : 0.7 + 0.3 * Math.sin(t * (0.6 + s.hue) + s.tw);
          ctx.globalAlpha = s.a * tw * fade;
          const f = colorOf(s);
          if (f !== fill) ctx.fillStyle = fill = f;
          ctx.beginPath();
          ctx.arc(sx[i], sy[i], s.r * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // The sun and moon move slowly: their places are worked out once a minute.
      if (now - skyAt > 60_000) {
        sky = skyNow();
        skyAt = now;
      }
      // The globe's radius on screen (MapLibre: a world 512·2^zoom pixels around).
      const globeR = ((512 * 2 ** zoom) / (2 * Math.PI)) * dpr;
      /**
       * Sun and moon hang around the globe in their real direction: far out when they light the
       * face we see, close to the rim (half hidden by the globe) when they are behind it.
       */
      const orb = (lng: number, lat: number, fallback: number) => {
        const q = project(lng, lat);
        const dx = q.x - cx, dy = q.y - cy;
        const ang = Math.hypot(dx, dy) < 2 ? fallback : Math.atan2(dy, dx);
        const far = Math.min(Math.hypot(W, H) * 0.42, globeR * 2.4);
        const r = Math.max(globeR * 1.02, globeR + (far - globeR) * ((q.z + 1) / 2));
        return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r };
      };
      // The sun: a warm glow with a bright, small core.
      const sp = orb(sky.sun[0], sky.sun[1], -2.3);
      const sr = 26 * dpr;
      let g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, sr * 9);
      g.addColorStop(0, 'rgba(255,236,190,0.55)');
      g.addColorStop(0.12, 'rgba(255,214,150,0.22)');
      g.addColorStop(0.4, 'rgba(255,170,110,0.06)');
      g.addColorStop(1, 'rgba(255,160,100,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sp.x - sr * 9, sp.y - sr * 9, sr * 18, sr * 18);
      g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, sr);
      g.addColorStop(0, '#fffdf4');
      g.addColorStop(0.55, '#fff2cc');
      g.addColorStop(1, 'rgba(255,226,160,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sr, 0, Math.PI * 2);
      ctx.fill();

      // The moon: a pale disc, its dark side turned away from the sun.
      const mp = orb(sky.moon[0], sky.moon[1], -0.6);
      const mr = 11 * dpr;
      g = ctx.createRadialGradient(mp.x, mp.y, mr * 0.6, mp.x, mp.y, mr * 4);
      g.addColorStop(0, 'rgba(200,215,255,0.16)');
      g.addColorStop(1, 'rgba(200,215,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(mp.x, mp.y, mr * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.arc(mp.x, mp.y, mr, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = 'rgba(40,48,70,0.9)';
      ctx.fillRect(mp.x - mr, mp.y - mr, mr * 2, mr * 2);
      // The lit part: a disc slid towards the sun, wider as the moon fills.
      const lit = 1 - Math.abs(sky.phase - 0.5) * 2; // 0 new, 1 full
      const ang = Math.atan2(sp.y - mp.y, sp.x - mp.x);
      const off = mr * 2 * (1 - lit);
      g = ctx.createRadialGradient(mp.x - mr * 0.3, mp.y - mr * 0.3, 0, mp.x, mp.y, mr * 1.2);
      g.addColorStop(0, '#fbfcff');
      g.addColorStop(1, '#c9d2e6');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(mp.x + Math.cos(ang) * off, mp.y + Math.sin(ang) * off, mr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      bound?.map.off('move', onMove);
    };
  }, [globe]);
  if (!globe) return null;
  return <canvas ref={ref} className="space-backdrop" aria-hidden />;
}

// ── Compass ──────────────────────────────────────────────────────────────────

/**
 * A compass like on Google Maps: the needle points north as the map turns, and a click turns the
 * map back to face exact north (and flat again when it was tilted).
 */
export function Compass() {
  const needle = useRef<HTMLSpanElement>(null);
  const [turned, setTurned] = useState(false);
  useEffect(() => {
    let bound: typeof mapCtl = null;
    let raf = 0;
    const sync = () => {
      const m = bound?.map;
      if (!m) return;
      const b = m.getBearing();
      const p = m.getPitch();
      if (needle.current) needle.current.style.transform = `rotateX(${p * 0.6}deg) rotate(${-b}deg)`;
      setTurned(Math.abs(b) > 0.5 || p > 0.5);
    };
    // The map is created by a sibling: wait for it.
    const bind = () => {
      if (!mapCtl) {
        raf = requestAnimationFrame(bind);
        return;
      }
      bound = mapCtl;
      bound.map.on('rotate', sync);
      bound.map.on('pitch', sync);
      sync();
    };
    bind();
    return () => {
      cancelAnimationFrame(raf);
      bound?.map.off('rotate', sync);
      bound?.map.off('pitch', sync);
    };
  }, []);
  const reset = () => mapCtl?.map.easeTo({ bearing: 0, pitch: 0, duration: 600 });
  return (
    <button className={'compass glass' + (turned ? ' turned' : '')} onClick={reset} title="Face north (Alt+drag or right-drag to turn the map)" aria-label="Reset to north">
      <span className="compass-needle" ref={needle}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
          <path d="M12 2.5 15.2 12H8.8z" fill="#ff4d5e" />
          <path d="M12 21.5 8.8 12h6.4z" fill="currentColor" opacity="0.55" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
        </svg>
        <i>N</i>
      </span>
    </button>
  );
}
