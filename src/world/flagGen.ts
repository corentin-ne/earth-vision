// Flags as small editable designs: a layout of up to three colours plus an optional emblem.
// The random generator and the flag maker share the same renderer.

export const FLAG_COLORS = ['#C8102E', '#FFFFFF', '#00247D', '#007A3D', '#FCD116', '#000000', '#0072CE', '#EF7D00', '#5B2C83', '#8D1B3D', '#00A3E0', '#F2A900'];
const W = 300;
const H = 200;

export type FlagLayout = 'plain' | 'h2' | 'h3' | 'v2' | 'v3' | 'nordic' | 'cross' | 'saltire' | 'canton' | 'diagonal' | 'chevron' | 'border';
export type Emblem = 'none' | 'star' | 'circle' | 'crescent' | 'stars';
export type EmblemPos = 'center' | 'hoist' | 'canton';

export interface FlagSpec {
  layout: FlagLayout;
  /** Colours of the layout's parts, in the order LAYOUTS lists them. */
  colors: [string, string, string];
  emblem: Emblem;
  emblemColor: string;
  emblemPos: EmblemPos;
  /** 0.5 – 1.5 */
  emblemSize: number;
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

export const EMBLEMS: { id: Emblem; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'star', label: 'Star' },
  { id: 'stars', label: 'Stars' },
  { id: 'circle', label: 'Sun' },
  { id: 'crescent', label: 'Crescent' },
];

type Rand = () => number;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Draws `spec` on a context whose drawing area is 300×200 (scale the context for other sizes). */
export function drawFlag(ctx: Ctx, spec: FlagSpec) {
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
  drawEmblem(ctx, spec);
}

function emblemCenter(spec: FlagSpec): [number, number, number] {
  const s = spec.emblemSize;
  if (spec.emblemPos === 'canton') return spec.layout === 'canton' ? [W * 0.21, H * 0.29, H * 0.15 * s] : [W * 0.2, H * 0.27, H * 0.14 * s];
  if (spec.emblemPos === 'hoist') return spec.layout === 'chevron' ? [W * 0.12, H / 2, H * 0.11 * s] : [W * 0.2, H / 2, H * 0.18 * s];
  return [W / 2, H / 2, H * 0.24 * s];
}

function drawEmblem(ctx: Ctx, spec: FlagSpec) {
  if (spec.emblem === 'none') return;
  const [cx, cy, r] = emblemCenter(spec);
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
  const canvas = new OffscreenCanvas(W * scale, H * scale);
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
