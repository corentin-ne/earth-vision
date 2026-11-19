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
  /** Classic atlas (serif, paper), modern (clean sans), or antique (classic on aged, grained paper). */
  style: 'classic' | 'modern' | 'antique';
  /**
   * Atlas page: title cartouche; country sheet: a big title block top left with the flag, coat
   * of arms and key facts of `focus`; minimal: the map full bleed under a large title.
   */
  layout?: 'atlas' | 'sheet' | 'minimal';
  focus?: PosterFocus;
  legendTitle: string;
  legendItems: LegendItem[];
}

/** What a country sheet tells about the place it shows. */
export interface PosterFocus {
  name: string;
  subtitle: string;
  flag: string | null;
  /** Coat of arms, as an image URL. */
  arms: string | null;
  facts: [string, string][];
}

function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Aged paper over the whole poster: grain, a few blotches and a darker rim. */
function agePaper(ctx: CanvasRenderingContext2D, w: number, h: number, u: number) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 256;
  const t = tile.getContext('2d')!;
  const img = t.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random();
    img.data[i] = 120;
    img.data[i + 1] = 88;
    img.data[i + 2] = 48;
    img.data[i + 3] = v < 0.5 ? 0 : Math.round((v - 0.5) * 70);
  }
  t.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = ctx.createPattern(tile, 'repeat')!;
  ctx.fillRect(0, 0, w, h);
  // A few soft stains, the same for a given size so re-exports match.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = (60 + rnd() * 160) * u;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(150,110,60,0.10)');
    g.addColorStop(1, 'rgba(150,110,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(120,80,40,0)');
  v.addColorStop(1, 'rgba(110,72,34,0.38)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
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
  const layout = o.layout ?? 'atlas';
  const serif = o.style !== 'modern';
  const margin = o.frame && layout !== 'minimal' ? Math.round(28 * u) : 0;
  const canvas = document.createElement('canvas');
  canvas.width = W + margin * 2;
  canvas.height = H + margin * 2;
  const ctx = canvas.getContext('2d')!;
  const ink = serif ? '#3b2f22' : '#1b2333';
  const paper = serif ? '#f3ead7' : '#ffffff';
  if (margin) {
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, margin, margin);
  if (o.style === 'antique') agePaper(ctx, canvas.width, canvas.height, u);
  if (margin) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.5 * u;
    ctx.strokeRect(margin, margin, W, H);
    ctx.lineWidth = 0.8 * u;
    ctx.strokeRect(margin - 8 * u, margin - 8 * u, W + 16 * u, H + 16 * u);
    if (serif) graduations(ctx, margin, W, H, u, ink);
  }
  const font = (weight: number, size: number, italic = false) =>
    `${italic ? 'italic ' : ''}${weight} ${size * u}px ${serif ? 'Georgia, "Times New Roman", serif' : '"Barlow Condensed", "Segoe UI", sans-serif'}`;
  const box = (x: number, y: number, w: number, h: number) => {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 8 * u;
    ctx.fillStyle = serif ? 'rgba(246,238,220,0.94)' : 'rgba(255,255,255,0.92)';
    roundRect(ctx, x, y, w, h, (serif ? 3 : 10) * u);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.2 * u;
    roundRect(ctx, x, y, w, h, (serif ? 3 : 10) * u);
    ctx.stroke();
    if (serif) {
      ctx.lineWidth = 0.6 * u;
      roundRect(ctx, x + 4 * u, y + 4 * u, w - 8 * u, h - 8 * u, 2 * u);
      ctx.stroke();
    }
  };
  const pad = 18 * u;

  if (layout === 'sheet') await titleSheet();
  else if (layout === 'minimal' && (o.title || o.subtitle)) titleBand();
  else if (o.cartouche && (o.title || o.subtitle)) {
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
      ctx.fillStyle = serif ? '#6b5a44' : '#5b6474';
      ctx.fillText(o.subtitle, x + w / 2, y + 62 * u);
    }
  }

  /** Country sheet: flag and arms, a big name, the subtitle, then the key facts, top left. */
  async function titleSheet() {
    const f = o.focus;
    const name = o.title || f?.name || '';
    const sub = o.subtitle || f?.subtitle || '';
    const [flag, arms] = await Promise.all([loadImage(f?.flag ?? null), loadImage(f?.arms ?? null)]);
    const facts = (f?.facts ?? []).slice(0, 8);
    const titleSize = name.length > 22 ? 40 : 54;
    ctx.font = font(700, titleSize);
    let w = ctx.measureText(name).width;
    ctx.font = font(400, 18, true);
    w = Math.max(w, ctx.measureText(sub).width);
    ctx.font = font(600, 15);
    const labelW = Math.max(0, ...facts.map(([k]) => ctx.measureText(k.toUpperCase()).width));
    const valueW = Math.max(0, ...facts.map(([, v]) => ctx.measureText(v).width));
    w = Math.max(w, labelW + valueW + 22 * u);
    const emblemH = 62 * u;
    const flagW = flag ? Math.min(110 * u, (emblemH * flag.width) / flag.height) : 0;
    const armsW = arms ? (emblemH * arms.width) / arms.height : 0;
    w = Math.max(w, flagW + armsW + 14 * u) + 48 * u;
    const top = flag || arms ? emblemH + 16 * u : 0;
    const h = 28 * u + top + titleSize * u + (sub ? 30 * u : 6 * u) + (facts.length ? 18 * u + facts.length * 24 * u : 0) + 16 * u;
    const x = margin + pad;
    const y = margin + pad;
    box(x, y, w, h);
    let yy = y + 26 * u;
    let xx = x + 24 * u;
    if (flag) {
      ctx.drawImage(flag, xx, yy, flagW, emblemH);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1 * u;
      ctx.strokeRect(xx, yy, flagW, emblemH);
      xx += flagW + 14 * u;
    }
    if (arms) ctx.drawImage(arms, xx, yy, armsW, emblemH);
    yy += top;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = ink;
    ctx.font = font(700, titleSize);
    yy += titleSize * u * 0.86;
    ctx.fillText(name, x + 24 * u, yy);
    if (sub) {
      ctx.font = font(400, 18, true);
      ctx.fillStyle = serif ? '#6b5a44' : '#5b6474';
      yy += 30 * u;
      ctx.fillText(sub, x + 24 * u, yy);
    }
    if (facts.length) {
      yy += 14 * u;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1 * u;
      ctx.beginPath();
      ctx.moveTo(x + 24 * u, yy);
      ctx.lineTo(x + w - 24 * u, yy);
      ctx.stroke();
      for (const [k, v] of facts) {
        yy += 24 * u;
        ctx.font = font(600, 12);
        ctx.fillStyle = serif ? '#7a6750' : '#6b7486';
        ctx.fillText(k.toUpperCase(), x + 24 * u, yy);
        ctx.font = font(700, 15);
        ctx.fillStyle = ink;
        ctx.textAlign = 'right';
        ctx.fillText(v, x + w - 24 * u, yy);
        ctx.textAlign = 'left';
      }
    }
  }

  /** Minimal: a large title on a soft band fading from the top-left corner, no box. */
  function titleBand() {
    const g = ctx.createLinearGradient(0, 0, 0, 170 * u);
    g.addColorStop(0, serif ? 'rgba(243,234,215,0.92)' : 'rgba(255,255,255,0.9)');
    g.addColorStop(1, serif ? 'rgba(243,234,215,0)' : 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, 170 * u);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = ink;
    ctx.font = font(700, 64);
    ctx.fillText(o.title, 34 * u, 82 * u);
    if (o.subtitle) {
      ctx.font = font(400, 20, true);
      ctx.fillStyle = serif ? '#6b5a44' : '#5b6474';
      ctx.fillText(o.subtitle, 36 * u, 116 * u);
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
  ctx.fillStyle = style !== 'modern' ? 'rgba(246,238,220,0.9)' : 'rgba(255,255,255,0.9)';
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
