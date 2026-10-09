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
  { id: 'flames', label: 'Flame border' },
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

/** A 'flames' flag's border: its solid band and the height of the curling crests on it. */
const BAND = 13;
const CREST = 19;
const EDGE = BAND + CREST;

/** The size of the whole drawing, flames included (scale the context for other sizes). */
export function flagSize(spec: FlagSpec): [number, number] {
  switch (spec.shape) {
    case 'wide':
      return [300, 150];
    case 'square':
      return [200, 200];
    case 'flames':
      return [300 + EDGE, 200 + EDGE * 2];
    default:
      return [300, 200];
  }
}

/** Where the coloured field sits inside the drawing. */
function fieldBox(spec: FlagSpec): [number, number, number, number] {
  if (spec.shape === 'flames') return [0, EDGE, 300, 200];
  const [w, h] = flagSize(spec);
  return [0, 0, w, h];
}

/** Draws `spec` on a context whose drawing area is flagSize(spec). Outside the shape stays transparent. */
export function drawFlag(ctx: Ctx, spec: FlagSpec) {
  const [x, y, w, h] = fieldBox(spec);
  if (spec.shape === 'flames') drawFlameBorder(ctx, w, h, spec.trim ?? '#3399CC');
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
    default:
      ctx.rect(0, 0, w, h);
  }
  ctx.closePath();
}

/**
 * One crest of the flame border, in edge space: u along the edge (0–1 of a period), v outward
 * (0–1 of the crest height), as cubic segments starting from (0, 0.15). A thin tongue rises from
 * the notch, then a big crest rolls over towards the fly and its tail curls back into a hook.
 */
const CREST_PATH = [
  [0.05, 0.3, 0.09, 0.6, 0.11, 0.78],
  [0.125, 0.62, 0.15, 0.38, 0.2, 0.22],
  [0.26, 0.6, 0.36, 1.0, 0.55, 1.0],
  [0.7, 1.0, 0.82, 0.9, 0.86, 0.78],
  [0.89, 0.7, 0.86, 0.6, 0.8, 0.62],
  [0.76, 0.64, 0.75, 0.56, 0.8, 0.5],
  [0.86, 0.42, 0.95, 0.2, 1.0, 0.15],
];

/** Crests along the edge from (x0, y0) to (x1, y1), rising along the outward normal (nx, ny). */
function crests(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, nx: number, ny: number) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.round(len / 56));
  const tx = (x1 - x0) / len;
  const ty = (y1 - y0) / len;
  const step = len / n;
  const at = (k: number, u: number, v: number) => [x0 + tx * (k + u) * step + nx * v * CREST, y0 + ty * (k + u) * step + ny * v * CREST];
  for (let k = 0; k < n; k++)
    for (const [a, b, c, d, e, f] of CREST_PATH) {
      const [p1x, p1y] = at(k, a, b);
      const [p2x, p2y] = at(k, c, d);
      const [p3x, p3y] = at(k, e, f);
      ctx.bezierCurveTo(p1x, p1y, p2x, p2y, p3x, p3y);
    }
}

/**
 * A band along the top, fly and bottom of a w×h field (the hoist stays straight), its outer
 * edge a row of curling crests, like the flame borders of old imperial banners.
 */
function drawFlameBorder(ctx: Ctx, w: number, h: number, col: string) {
  const top = CREST;
  const fly = w + BAND;
  const bottom = h + EDGE + BAND;
  const lift = 0.15 * CREST;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(0, top - lift);
  crests(ctx, 0, top, fly, top, 0, -1);
  ctx.lineTo(fly + lift, top);
  crests(ctx, fly, top, fly, bottom, 1, 0);
  ctx.lineTo(fly, bottom + lift);
  crests(ctx, fly, bottom, 0, bottom, 0, 1);
  ctx.lineTo(0, top);
  ctx.closePath();
  ctx.fill();
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
