// Poster export: the current view rendered at a higher resolution, framed like a printed map,
// with a title cartouche, a legend, a compass rose and a scale bar.
import type { Map as MLMap } from 'maplibre-gl';
import type { LegendItem } from '../world/thematic';

export interface PosterOpts {
  title: string;
  subtitle: string;
  /** Output pixels per screen pixel. */
  scale: number;
  cartouche: boolean;
  legend: boolean;
  compass: boolean;
  scaleBar: boolean;
  frame: boolean;
  style: 'classic' | 'modern';
  legendTitle: string;
  legendItems: LegendItem[];
}

/**
 * Renders the map at `scale` times its size and returns the drawn canvas. `pause` stops what
 * keeps the map from ever being idle (the animated water) while it renders.
 */
async function renderMap(map: MLMap, scale: number, pause: (on: boolean) => void): Promise<HTMLCanvasElement> {
  const before = map.getPixelRatio();
  const target = Math.min(scale * (window.devicePixelRatio || 1), maxRatio(map));
  pause(true);
  map.setPixelRatio(target);
  try {
    await waitForTiles(map);
    return await new Promise<HTMLCanvasElement>((resolve) => {
      map.once('render', () => {
        const src = map.getCanvas();
        const out = document.createElement('canvas');
        out.width = src.width;
        out.height = src.height;
        out.getContext('2d')!.drawImage(src, 0, 0);
        resolve(out);
      });
      map.triggerRepaint();
    });
  } finally {
    map.setPixelRatio(before);
    pause(false);
  }
}

/** The largest pixel ratio the GPU can draw this map at. */
function maxRatio(map: MLMap): number {
  const gl = map.getCanvas().getContext('webgl2') ?? map.getCanvas().getContext('webgl');
  const max = gl ? (gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number) : 4096;
  const c = map.getContainer();
  return Math.max(1, Math.min(max / c.clientWidth, max / c.clientHeight, 8));
}

/** Resolves once the map has drawn everything at the new size (or after 20 s, whatever it has). */
function waitForTiles(map: MLMap): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(finish, 20_000);
    map.once('idle', finish);
    map.triggerRepaint();
  });
}

export async function makePoster(map: MLMap, o: PosterOpts, pause: (on: boolean) => void = () => {}): Promise<Blob | null> {
  const img = await renderMap(map, o.scale, pause);
  const W = img.width;
  const H = img.height;
  // One "unit" of decoration scales with the output, so a 4× poster looks like a 1× one.
  const u = W / map.getContainer().clientWidth;
  const margin = o.frame ? Math.round(28 * u) : 0;
  const canvas = document.createElement('canvas');
  canvas.width = W + margin * 2;
  canvas.height = H + margin * 2;
  const ctx = canvas.getContext('2d')!;
  const ink = o.style === 'classic' ? '#3b2f22' : '#1b2333';
  const paper = o.style === 'classic' ? '#f3ead7' : '#ffffff';
  if (o.frame) {
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, margin, margin);
  if (o.frame) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.5 * u;
    ctx.strokeRect(margin, margin, W, H);
    ctx.lineWidth = 0.8 * u;
    ctx.strokeRect(margin - 8 * u, margin - 8 * u, W + 16 * u, H + 16 * u);
    if (o.style === 'classic') graduations(ctx, margin, W, H, u, ink);
  }
  const font = (weight: number, size: number, italic = false) =>
    `${italic ? 'italic ' : ''}${weight} ${size * u}px ${o.style === 'classic' ? 'Georgia, "Times New Roman", serif' : '"Barlow Condensed", "Segoe UI", sans-serif'}`;
  const box = (x: number, y: number, w: number, h: number) => {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 8 * u;
    ctx.fillStyle = o.style === 'classic' ? 'rgba(246,238,220,0.94)' : 'rgba(255,255,255,0.92)';
    roundRect(ctx, x, y, w, h, (o.style === 'classic' ? 3 : 10) * u);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.2 * u;
    roundRect(ctx, x, y, w, h, (o.style === 'classic' ? 3 : 10) * u);
    ctx.stroke();
    if (o.style === 'classic') {
      ctx.lineWidth = 0.6 * u;
      roundRect(ctx, x + 4 * u, y + 4 * u, w - 8 * u, h - 8 * u, 2 * u);
      ctx.stroke();
    }
  };
  const pad = 18 * u;

  if (o.cartouche && (o.title || o.subtitle)) {
    ctx.font = font(700, 30);
    const tw = ctx.measureText(o.title).width;
    ctx.font = font(400, 15, true);
    const sw = ctx.measureText(o.subtitle).width;
    const w = Math.max(tw, sw) + 44 * u;
    const h = (o.subtitle ? 78 : 56) * u;
    const x = margin + pad;
    const y = margin + pad;
    box(x, y, w, h);
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(700, 30);
    ctx.fillText(o.title, x + w / 2, y + 38 * u);
    if (o.subtitle) {
      ctx.font = font(400, 15, true);
      ctx.fillStyle = o.style === 'classic' ? '#6b5a44' : '#5b6474';
      ctx.fillText(o.subtitle, x + w / 2, y + 62 * u);
    }
  }

  if (o.legend && o.legendItems.length) {
    const items = o.legendItems.slice(0, 14);
    ctx.font = font(500, 13);
    const lw = Math.max(ctx.measureText(o.legendTitle).width + 10 * u, ...items.map((i) => ctx.measureText(i.label).width)) + 54 * u;
    const lh = (40 + items.length * 21) * u;
    const x = margin + pad;
    const y = margin + H - pad - lh;
    box(x, y, lw, lh);
    ctx.textAlign = 'left';
    ctx.fillStyle = ink;
    ctx.font = font(700, 14);
    ctx.fillText(o.legendTitle, x + 14 * u, y + 25 * u);
    ctx.font = font(500, 13);
    items.forEach((it, i) => {
      const yy = y + (44 + i * 21) * u;
      ctx.fillStyle = it.color;
      roundRect(ctx, x + 14 * u, yy - 10 * u, 22 * u, 13 * u, 2 * u);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.8 * u;
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.fillText(it.label, x + 44 * u, yy);
    });
  }

  if (o.compass) compass(ctx, margin + W - pad - 44 * u, margin + pad + 50 * u, 38 * u, -map.getBearing(), ink, paper, o.style, u);

  if (o.scaleBar) {
    const c = map.getCenter();
    // Metres per CSS pixel at the centre (Web Mercator, 512 px tiles).
    const mpp = (40075016.686 * Math.cos((c.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
    const maxPx = map.getContainer().clientWidth / 5;
    const nice = niceDistance(mpp * maxPx);
    const px = (nice / mpp) * u;
    const x = margin + W - pad - px - 16 * u;
    const y = margin + H - pad - 18 * u;
    box(x - 14 * u, y - 30 * u, px + 28 * u, 46 * u);
    ctx.fillStyle = ink;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? paper : ink;
      ctx.fillRect(x + (px / 4) * i, y, px / 4, 6 * u);
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1 * u;
    ctx.strokeRect(x, y, px, 6 * u);
    ctx.fillStyle = ink;
    ctx.font = font(600, 12);
    ctx.textAlign = 'center';
    ctx.fillText('0', x, y - 6 * u);
    ctx.fillText(fmtDist(nice), x + px, y - 6 * u);
    ctx.fillText(fmtDist(nice / 2), x + px / 2, y - 6 * u);
  }

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

function niceDistance(m: number): number {
  const p = 10 ** Math.floor(Math.log10(m));
  for (const k of [5, 2, 1]) if (k * p <= m) return k * p;
  return p;
}

const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toLocaleString('en-US')} km` : `${Math.round(m)} m`);

function compass(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, deg: number, ink: string, paper: string, style: string, u: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = style === 'classic' ? 'rgba(246,238,220,0.9)' : 'rgba(255,255,255,0.9)';
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1 * u;
  ctx.stroke();
  // Eight points: long cardinal, short intercardinal; each half dark, half light.
  for (let i = 0; i < 8; i++) {
    const len = i % 2 ? r * 0.55 : r;
    const w = i % 2 ? r * 0.1 : r * 0.16;
    ctx.save();
    ctx.rotate((i * Math.PI) / 4);
    ctx.beginPath();
    ctx.moveTo(0, -len);
    ctx.lineTo(w, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = ink;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -len);
    ctx.lineTo(-w, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = paper;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.7 * u;
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = ink;
  ctx.font = `700 ${r * 0.34}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('N', 0, -r - 2 * u);
  ctx.restore();
}

/** Classic style: alternating ticks along the frame, like an old atlas border. */
function graduations(ctx: CanvasRenderingContext2D, margin: number, W: number, H: number, u: number, ink: string) {
  const step = 24 * u;
  ctx.fillStyle = ink;
  for (let x = 0, i = 0; x < W; x += step, i++) {
    if (i % 2) continue;
    ctx.fillRect(margin + x, margin - 8 * u, Math.min(step, W - x), 3 * u);
    ctx.fillRect(margin + x, margin + H + 5 * u, Math.min(step, W - x), 3 * u);
  }
  for (let y = 0, i = 0; y < H; y += step, i++) {
    if (i % 2) continue;
    ctx.fillRect(margin - 8 * u, margin + y, 3 * u, Math.min(step, H - y));
    ctx.fillRect(margin + W + 5 * u, margin + y, 3 * u, Math.min(step, H - y));
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
