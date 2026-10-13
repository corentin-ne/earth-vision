import { useEffect, useRef } from 'react';
import { mapCtl } from '../map/controller';
import { useWorld } from '../world/store';

/** How long the drawn globe takes to grow into the real one once the map is ready. */
export const HANDOFF_MS = 1000;
const DEG = Math.PI / 180;
/** The sphere's radius inside the drawing (viewBox −120…120). */
const R = 80;
const MERIDIANS = 6;
const PARALLELS = [-60, -30, 0, 30, 60];
/** How far we look down on the globe: the parallels open into thin ellipses. */
const VIEW_TILT = 16;

/** Where and how big the real globe stands on screen. */
function mapGlobe(): { x: number; y: number; r: number; bearing: number } | null {
  const m = mapCtl?.map;
  if (!m) return null;
  const box = m.getContainer().getBoundingClientRect();
  const c = m.getCenter();
  const p = m.project(c);
  if (!useWorld.getState().globe) return { x: box.left + p.x, y: box.top + p.y, r: Math.hypot(box.width, box.height), bearing: m.getBearing() };
  // MapLibre's globe: a world 512·2^zoom pixels around at the centre's latitude, seen in perspective.
  const rr = (512 * 2 ** m.getZoom()) / (2 * Math.PI) / Math.max(0.05, Math.cos(c.lat * DEG));
  const fov = (m as unknown as { transform?: { fov?: number } }).transform?.fov ?? 36.87;
  const cam = box.height / 2 / Math.tan((fov * DEG) / 2);
  const r = cam * Math.tan(Math.asin(Math.min(0.999, rr / (cam + rr))));
  return { x: box.left + p.x, y: box.top + p.y, r, bearing: m.getBearing() };
}

/**
 * The loading screen: a globe drawn in fine lines like an astrolabe, its meridians turning, a
 * moon on its orbit and a ring that closes as the world loads. When the map is ready the rings
 * fall away and the drawn sphere grows to the exact size and place of the real globe, which fades
 * in under it. All of it is vector and CSS, so it stays smooth while the map loads.
 */
export function BootGlobe({ ready, progress }: { ready: boolean; progress: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !ready) return;
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const r0 = (box.width * R) / 240;
    const W = window.innerWidth, H = window.innerHeight;
    const to = mapGlobe() ?? { x: W / 2, y: H / 2, r: Math.hypot(W, H), bearing: 0 };
    el.classList.add('handoff');
    el.style.transform = `translate(${to.x - cx}px, ${to.y - cy}px) rotate(${-to.bearing}deg) scale(${to.r / r0})`;
  }, [ready]);

  const tiltY = Math.sin(VIEW_TILT * DEG);
  return (
    <div className="orrery" ref={ref} aria-hidden>
      <svg viewBox="-120 -120 240 240">
        <defs>
          <radialGradient id="orrery-body" cx="38%" cy="32%" r="75%">
            <stop offset="0" stopColor="#2a5a8a" stopOpacity="0.55" />
            <stop offset="0.55" stopColor="#10284a" stopOpacity="0.5" />
            <stop offset="1" stopColor="#050b18" stopOpacity="0.2" />
          </radialGradient>
          <radialGradient id="orrery-rim" cx="50%" cy="50%" r="50%">
            <stop offset="0.86" stopColor="#7fd8ff" stopOpacity="0" />
            <stop offset="0.97" stopColor="#9fe3ff" stopOpacity="0.35" />
            <stop offset="1" stopColor="#c8f0ff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="orrery-arc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent-hi, #7ff0d8)" />
            <stop offset="1" stopColor="var(--accent, #3ecfb2)" />
          </linearGradient>
          <clipPath id="orrery-clip">
            <circle r={R} />
          </clipPath>
        </defs>

        {/* The orbit behind the globe. */}
        <g className="orrery-orbit" transform="rotate(-14)">
          <ellipse rx="108" ry="26" className="orbit-line" />
        </g>

        <circle r={R + 10} fill="url(#orrery-rim)" className="orrery-halo" />
        <circle r={R} fill="url(#orrery-body)" />
        <g clipPath="url(#orrery-clip)" className="orrery-lines">
          <g transform="rotate(-23.4)">
            {PARALLELS.map((lat) => {
              const rx = R * Math.cos(lat * DEG);
              return <ellipse key={lat} cy={-R * Math.sin(lat * DEG) * Math.cos(VIEW_TILT * DEG)} rx={rx} ry={rx * tiltY} className={'par' + (lat === 0 ? ' eq' : '')} />;
            })}
            {Array.from({ length: MERIDIANS }, (_, k) => (
              <ellipse key={k} rx={R} ry={R} className="mer" style={{ animationDelay: `${(-8 / (MERIDIANS * 2)) * k}s` }} />
            ))}
          </g>
        </g>
        <circle r={R} className="orrery-edge" />
        {/* The axis, out through the poles. */}
        <g transform="rotate(-23.4)" className="orrery-axis">
          <line y1={-R - 18} y2={-R - 4} />
          <line y1={R + 4} y2={R + 18} />
        </g>

        {/* The front half of the orbit and its moon, passing in front of the globe. */}
        <g className="orrery-orbit" transform="rotate(-14)">
          <path d="M -108 0 A 108 26 0 0 0 108 0" className="orbit-line front" />
          <circle r="3.2" className="moon">
            <animateMotion dur="7s" repeatCount="indefinite" path="M 108 0 A 108 26 0 1 1 -108 0 A 108 26 0 1 1 108 0" />
          </circle>
        </g>

        {/* Progress: a fine ring closing around everything. */}
        <circle r="116" className="orrery-track" />
        <circle r="116" className="orrery-progress" pathLength={1} style={{ strokeDashoffset: 1 - progress }} transform="rotate(-90)" />

        {[
          [-98, -78, 0],
          [96, -64, 1.3],
          [84, 86, 2.1],
          [-90, 74, 0.7],
        ].map(([x, y, d], i) => (
          <path key={i} className="glint" style={{ animationDelay: `${d}s` }} transform={`translate(${x} ${y})`} d="M0 -5 L1 -1 L5 0 L1 1 L0 5 L-1 1 L-5 0 L-1 -1 Z" />
        ))}
      </svg>
    </div>
  );
}
