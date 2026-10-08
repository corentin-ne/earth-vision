// Flags as small editable designs: a layout of up to three colours, an optional emblem and a
// shape (proportions, a cut-out silhouette or a flame border). The random generator and the
// flag maker share the same renderer.

export const FLAG_COLORS = ['#C8102E', '#FFFFFF', '#00247D', '#007A3D', '#FCD116', '#000000', '#0072CE', '#EF7D00', '#5B2C83', '#8D1B3D', '#00A3E0', '#F2A900'];
export type FlagLayout = 'plain' | 'h2' | 'h3' | 'v2' | 'v3' | 'nordic' | 'cross' | 'saltire' | 'canton' | 'diagonal' | 'chevron' | 'border';
export type Emblem = 'none' | 'star' | 'circle' | 'crescent' | 'stars';
export type EmblemPos = 'center' | 'hoist' | 'canton';
export type FlagShape = 'rect' | 'wide' | 'square' | 'swallowtail' | 'pennant' | 'flames';

export interface FlagSpec {
  layout: FlagLayout;
  /** Colours of the layout's parts, in the order LAYOUTS lists them. */
  colors: [string, string, string];
  emblem: Emblem;
  emblemColor: string;
  emblemPos: EmblemPos;
  /** 0.5 – 1.5 */
  emblemSize: number;
  /** Outline of the flag; a classic 3:2 rectangle when absent. */
  shape?: FlagShape;
  /** Colour of the flames around a 'flames' flag. */
  trim?: string;
}

/** Layouts and the names of the parts their colours paint. */
export const LAYOUTS: { id: FlagLayout; label: string; parts: string[] }[] = [
  { id: 'h3', label: 'Three bands', parts: ['Top', 'Middle', 'Bottom'] },
  { id: 'v3', label: 'Tricolour', parts: ['Hoist', 'Middle', 'Fly'] },
  { id: 'h2', label: 'Two bands', parts: ['Top', 'Bottom'] },
  { id: 'v2', label: 'Two columns', parts: ['Hoist', 'Fly'] },
  { id: 'nordic', label: 'Nordic cross', parts: ['Field', 'Cross', 'Inner cross'] },
  { id: 'cross', label: 'Cross', parts: ['Field', 'Cross'] },
  { id: 'saltire', label: 'Saltire', parts: ['Field', 'Saltire'] },
  { id: 'canton', label: 'Stripes & canton', parts: ['Stripe', 'Stripe', 'Canton'] },
  { id: 'diagonal', label: 'Diagonal', parts: ['Upper', 'Lower', 'Band'] },
  { id: 'chevron', label: 'Chevron', parts: ['Top', 'Bottom', 'Chevron'] },
  { id: 'border', label: 'Bordered', parts: ['Field', 'Border'] },
  { id: 'plain', label: 'Plain', parts: ['Field'] },
];

export const SHAPES: { id: FlagShape; label: string }[] = [
  { id: 'rect', label: 'Classic 3:2' },
  { id: 'wide', label: 'Wide 2:1' },
  { id: 'square', label: 'Square' },
  { id: 'swallowtail', label: 'Swallowtail' },
  { id: 'pennant', label: 'Pennant' },
  { id: 'flames', label: 'Flames' },
];

export const EMBLEMS: { id: Emblem; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'star', label: 'Star' },
  { id: 'stars', label: 'Stars' },
  { id: 'circle', label: 'Sun' },
  { id: 'crescent', label: 'Crescent' },
];

type Rand = () => number;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** How far the flames reach out from the field of a 'flames' flag. */
const FLAME = 32;

/** The size of the whole drawing, flames included (scale the context for other sizes). */
export function flagSize(spec: FlagSpec): [number, number] {
  switch (spec.shape) {
    case 'wide':
      return [300, 150];
    case 'square':
      return [200, 200];
    case 'flames':
      return [300 + FLAME * 2, 200 + FLAME * 2];
    default:
      return [300, 200];
  }
}

/** Where the coloured field sits inside the drawing. */
function fieldBox(spec: FlagSpec): [number, number, number, number] {
  if (spec.shape === 'flames') return [FLAME, FLAME, 300, 200];
  const [w, h] = flagSize(spec);
  return [0, 0, w, h];
}

/** Draws `spec` on a context whose drawing area is flagSize(spec). Outside the shape stays transparent. */
export function drawFlag(ctx: Ctx, spec: FlagSpec) {
  const [x, y, w, h] = fieldBox(spec);
  if (spec.shape === 'flames') drawFlames(ctx, x, y, w, h, spec.trim ?? '#1E6BFF');
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  shapePath(ctx, spec.shape, w, h);
  ctx.clip();
  drawField(ctx, spec, w, h);
  ctx.restore();
}

function shapePath(ctx: Ctx, shape: FlagShape | undefined, w: number, h: number) {
  switch (shape) {
    case 'swallowtail':
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w * 0.74, h / 2);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      break;
    case 'pennant':
      ctx.moveTo(0, 0);
      ctx.lineTo(w, h / 2);
      ctx.lineTo(0, h);
      break;
    case 'flames': {
      const r = 14;
      ctx.moveTo(r, 0);
      ctx.arcTo(w, 0, w, h, r);
      ctx.arcTo(w, h, 0, h, r);
      ctx.arcTo(0, h, 0, 0, r);
      ctx.arcTo(0, 0, w, 0, r);
      break;
    }
    default:
      ctx.rect(0, 0, w, h);
  }
  ctx.closePath();
}

/**
 * Tongues of fire all around the field: an outer ring in `col`, a lighter inner ring, each
 * tongue a little longer or shorter and leaning a little, so the edge reads as alive.
 */
function drawFlames(ctx: Ctx, x: number, y: number, w: number, h: number, col: string) {
  const light = mix(col, '#FFFFFF', 0.55);
  // Walk the field's edge clockwise: [start x, start y, tangent, outward normal, length].
  const sides: [number, number, [number, number], [number, number], number][] = [
    [x, y, [1, 0], [0, -1], w],
    [x + w, y, [0, 1], [1, 0], h],
    [x + w, y + h, [-1, 0], [0, 1], w],
    [x, y + h, [0, -1], [-1, 0], h],
  ];
  const tongues: { px: number; py: number; t: [number, number]; n: [number, number]; i: number; base: number }[] = [];
  let i = 0;
  for (const [sx, sy, t, n, len] of sides) {
    const count = Math.max(3, Math.round(len / 26));
    const step = len / count;
    for (let k = 0; k < count; k++, i++) {
      const d = (k + 0.5) * step;
      tongues.push({ px: sx + t[0] * d, py: sy + t[1] * d, t, n, i, base: step });
    }
    // A tongue on each corner, pointing out diagonally.
    const cx = sx + t[0] * len;
    const cy = sy + t[1] * len;
    const dn: [number, number] = [(n[0] + t[0]) * Math.SQRT1_2, (n[1] + t[1]) * Math.SQRT1_2];
    tongues.push({ px: cx, py: cy, t: [-dn[1], dn[0]], n: dn, i: i++, base: step * 0.9 });
  }
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.rect(x - 6, y - 6, w + 12, h + 12);
  ctx.fill();
  for (const [fill, k] of [
    [col, 1],
    [light, 0.58],
  ] as const) {
    ctx.fillStyle = fill;
    for (const g of tongues) {
      const len = FLAME * k * (0.62 + 0.38 * Math.abs(Math.sin(g.i * 2.39)));
      const lean = Math.sin(g.i * 1.71) * 0.32;
      const bw = g.base * (k === 1 ? 0.62 : 0.42);
      const [tx, ty] = g.t;
      const [nx, ny] = g.n;
      const tipX = g.px + nx * len + tx * len * lean;
      const tipY = g.py + ny * len + ty * len * lean;
      ctx.beginPath();
      ctx.moveTo(g.px - tx * bw, g.py - ty * bw);
      ctx.quadraticCurveTo(g.px - tx * bw * 0.1 + nx * len * 0.6, g.py - ty * bw * 0.1 + ny * len * 0.6, tipX, tipY);
      ctx.quadraticCurveTo(g.px + tx * bw * 0.55 + nx * len * 0.35, g.py + ty * bw * 0.55 + ny * len * 0.35, g.px + tx * bw, g.py + ty * bw);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/** The design itself, on a W×H field. */
function drawField(ctx: Ctx, spec: FlagSpec, W: number, H: number) {
  const [a, b, c] = spec.colors;
  const rect = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  const poly = (pts: number[], col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    ctx.fill();
  };
  switch (spec.layout) {
    case 'plain':
      rect(0, 0, W, H, a);
      break;
    case 'h2':
      rect(0, 0, W, H / 2, a);
      rect(0, H / 2, W, H / 2, b);
      break;
    case 'h3':
      rect(0, 0, W, H / 3 + 1, a);
      rect(0, H / 3, W, H / 3 + 1, b);
      rect(0, (2 * H) / 3, W, H / 3 + 1, c);
      break;
    case 'v2':
      rect(0, 0, W / 2 + 1, H, a);
      rect(W / 2, 0, W / 2, H, b);
      break;
    case 'v3':
      rect(0, 0, W / 3 + 1, H, a);
      rect(W / 3, 0, W / 3 + 1, H, b);
      rect((2 * W) / 3, 0, W / 3 + 1, H, c);
      break;
    case 'nordic':
      rect(0, 0, W, H, a);
      rect(0, H * 0.4, W, H * 0.2, b);
      rect(W * 0.3, 0, H * 0.2, H, b);
      if (c !== b) {
        rect(0, H * 0.45, W, H * 0.1, c);
        rect(W * 0.3 + H * 0.05, 0, H * 0.1, H, c);
      }
      break;
    case 'cross':
      rect(0, 0, W, H, a);
      rect(0, H * 0.4, W, H * 0.2, b);
      rect(W / 2 - H * 0.1, 0, H * 0.2, H, b);
      break;
    case 'saltire':
      rect(0, 0, W, H, a);
      ctx.strokeStyle = b;
      ctx.lineWidth = H * 0.18;
      ctx.beginPath();
      ctx.moveTo(-10, -7);
      ctx.lineTo(W + 10, H + 7);
      ctx.moveTo(W + 10, -7);
      ctx.lineTo(-10, H + 7);
      ctx.stroke();
      break;
    case 'canton':
      for (let i = 0; i < 7; i++) rect(0, (i * H) / 7, W, H / 7 + 1, i % 2 ? b : a);
      rect(0, 0, W * 0.42, (H * 4) / 7, c);
      break;
    case 'diagonal':
      rect(0, 0, W, H, a);
      poly([W, 0, W, H, 0, H], b);
      if (c !== a && c !== b) {
        ctx.strokeStyle = c;
        ctx.lineWidth = H * 0.14;
        ctx.beginPath();
        ctx.moveTo(-10, H + 7);
        ctx.lineTo(W + 10, -7);
        ctx.stroke();
      }
      break;
    case 'chevron':
      rect(0, 0, W, H / 2, a);
      rect(0, H / 2, W, H / 2, b);
      poly([0, 0, W * 0.38, H / 2, 0, H], c);
      break;
    case 'border':
      rect(0, 0, W, H, b);
      rect(H * 0.1, H * 0.1, W - H * 0.2, H * 0.8, a);
      break;
  }
  drawEmblem(ctx, spec, W, H);
}

function emblemCenter(spec: FlagSpec, W: number, H: number): [number, number, number] {
  const s = spec.emblemSize;
  // A pennant narrows to a point: keep the emblem in its broad part.
  if (spec.shape === 'pennant') return [W * (spec.emblemPos === 'center' ? 0.3 : 0.17), H / 2, H * (spec.emblemPos === 'center' ? 0.2 : 0.15) * s];
  if (spec.emblemPos === 'canton') return spec.layout === 'canton' ? [W * 0.21, H * 0.29, H * 0.15 * s] : [W * 0.2, H * 0.27, H * 0.14 * s];
  if (spec.emblemPos === 'hoist') return spec.layout === 'chevron' ? [W * 0.12, H / 2, H * 0.11 * s] : [W * 0.2, H / 2, H * 0.18 * s];
  return [W / 2, H / 2, H * 0.24 * s];
}

function drawEmblem(ctx: Ctx, spec: FlagSpec, W: number, H: number) {
  if (spec.emblem === 'none') return;
  const [cx, cy, r] = emblemCenter(spec, W, H);
  const col = spec.emblemColor;
  if (spec.emblem === 'star') star(ctx, cx, cy, r, col);
  if (spec.emblem === 'stars') for (let i = 0; i < 5; i++) {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    star(ctx, cx + Math.cos(ang) * r * 0.75, cy + Math.sin(ang) * r * 0.75, r * 0.3, col);
  }
  if (spec.emblem === 'circle') {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  if (spec.emblem === 'crescent') {
    // A crescent: the disc minus a shifted disc, drawn with compositing on a scratch canvas.
    const size = Math.ceil(r * 2.4);
    const tmp = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : null;
    const t = tmp?.getContext('2d');
    if (!t || !tmp) return;
    t.fillStyle = col;
    t.beginPath();
    t.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    t.fill();
    t.globalCompositeOperation = 'destination-out';
    t.beginPath();
    t.arc(size / 2 + r * 0.38, size / 2 - r * 0.05, r * 0.82, 0, Math.PI * 2);
    t.fill();
    ctx.drawImage(tmp, cx - size / 2, cy - size / 2);
  }
}

function star(ctx: Ctx, cx: number, cy: number, r: number, col: string) {
  ctx.fillStyle = col;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.4 : r;
    ctx.lineTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};
/** `a` blended towards `b` by `t` (0–1). */
function mix(a: string, b: string, t: number): string {
  const ca = parseInt(a.slice(1), 16);
  const cb = parseInt(b.slice(1), 16);
  const ch = [16, 8, 0].map((sh) => Math.round(((ca >> sh) & 255) * (1 - t) + ((cb >> sh) & 255) * t));
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Black or white, whichever reads better on `hex`. */
export const contrast = (hex: string) => (lum(hex) > 150 ? '#000000' : '#FFFFFF');

/** Map pastels are too pale for a flag: push them towards a saturated dye. */
export function deepen(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return '#00247D';
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const min = Math.min(...ch);
  const max = Math.max(...ch);
  const out = ch.map((v) => (max === min ? v * 0.5 : ((v - min) / (max - min)) * 200 + 20));
  return '#' + out.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** A random design; `base` (the country colour, usually) is often worked into it. */
export function randomSpec(base?: string, rand: Rand = Math.random): FlagSpec {
  const pick = () => FLAG_COLORS[Math.floor(rand() * FLAG_COLORS.length)];
  const cols: string[] = [];
  if (base && rand() < 0.5) cols.push(deepen(base));
  while (cols.length < 3) {
    const c = pick();
    if (!cols.includes(c)) cols.push(c);
  }
  const layout = LAYOUTS[Math.floor(rand() * (LAYOUTS.length - 1))].id; // not 'plain' (last)
  const r = rand();
  const emblem: Emblem = r < 0.45 ? 'none' : r < 0.75 ? 'star' : r < 0.85 ? 'stars' : r < 0.93 ? 'circle' : 'crescent';
  const emblemPos: EmblemPos = layout === 'canton' || layout === 'nordic' ? 'canton' : layout === 'chevron' ? 'hoist' : rand() < 0.7 ? 'center' : 'hoist';
  const under = layout === 'canton' ? cols[2] : layout === 'chevron' ? cols[2] : cols[0];
  return {
    layout,
    colors: [cols[0], cols[1], cols[2]],
    emblem,
    emblemColor: contrast(under) === '#FFFFFF' && rand() < 0.5 ? '#FCD116' : contrast(under),
    emblemPos,
    emblemSize: 0.8 + rand() * 0.4,
  };
}

/** Renders a design to a PNG (drawn at 2× so it stays crisp in the full-size flag view). */
export async function renderFlag(spec: FlagSpec, scale = 2): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const [w, h] = flagSize(spec);
  const canvas = new OffscreenCanvas(w * scale, h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);
  drawFlag(ctx, spec);
  return canvas.convertToBlob({ type: 'image/png' });
}

/** Draws a random flag; deterministic for a seeded `rand`. */
export async function randomFlag(base?: string, rand: Rand = Math.random): Promise<Blob | null> {
  return renderFlag(randomSpec(base, rand));
}
