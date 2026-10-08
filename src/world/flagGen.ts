// Procedural flags: stripes, crosses, cantons, discs and stars in heraldic colours.

const COLORS = ['#C8102E', '#FFFFFF', '#00247D', '#007A3D', '#FCD116', '#000000', '#0072CE', '#EF7D00', '#5B2C83', '#8D1B3D', '#00A3E0', '#F2A900'];
const W = 300;
const H = 200;

type Rand = () => number;
type Ctx = OffscreenCanvasRenderingContext2D;

/** Draws a random flag; `base` (the country colour, usually) is often worked into it. */
export async function randomFlag(base?: string, rand: Rand = Math.random): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;
  // Drawn at twice the nominal size so it stays crisp in the full-size flag view.
  const canvas = new OffscreenCanvas(W * 2, H * 2);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(2, 2);
  drawFlag(ctx, base, rand);
  return canvas.convertToBlob({ type: 'image/png' });
}

function drawFlag(ctx: Ctx, base: string | undefined, rand: Rand) {
  const pick = () => COLORS[Math.floor(rand() * COLORS.length)];
  // Three distinct colours; the country colour, darkened to look like cloth dye, comes first half the time.
  const cols: string[] = [];
  if (base && rand() < 0.5) cols.push(deepen(base));
  while (cols.length < 3) {
    const c = pick();
    if (!cols.includes(c)) cols.push(c);
  }
  const [a, b, c] = cols;
  const rect = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  const design = Math.floor(rand() * 8);
  switch (design) {
    case 0: // horizontal tricolour
      rect(0, 0, W, H / 3, a);
      rect(0, H / 3, W, H / 3, b);
      rect(0, (2 * H) / 3, W, H / 3 + 1, c);
      break;
    case 1: // vertical tricolour
      rect(0, 0, W / 3, H, a);
      rect(W / 3, 0, W / 3, H, b);
      rect((2 * W) / 3, 0, W / 3 + 1, H, c);
      break;
    case 2: // nordic cross
      rect(0, 0, W, H, a);
      rect(0, H * 0.4, W, H * 0.2, b);
      rect(W * 0.3, 0, H * 0.2, H, b);
      if (rand() < 0.6) {
        rect(0, H * 0.45, W, H * 0.1, c);
        rect(W * 0.3 + H * 0.05, 0, H * 0.1, H, c);
      }
      break;
    case 3: // bicolour with a disc
      rect(0, 0, W, H / 2, a);
      rect(0, H / 2, W, H / 2, b);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, H * 0.24, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 4: // canton with a star, stripes elsewhere
      for (let i = 0; i < 5; i++) rect(0, (i * H) / 5, W, H / 5 + 1, i % 2 ? b : a);
      rect(0, 0, W * 0.42, H * 0.6, c);
      star(ctx, W * 0.21, H * 0.3, H * 0.17, a === '#FFFFFF' || b === '#FFFFFF' ? '#FFFFFF' : b);
      return;
    case 5: // diagonal split
      rect(0, 0, W, H, a);
      ctx.fillStyle = b;
      ctx.beginPath();
      ctx.moveTo(W, 0);
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.fill();
      if (rand() < 0.7) {
        ctx.strokeStyle = c;
        ctx.lineWidth = H * 0.14;
        ctx.beginPath();
        ctx.moveTo(-10, H + 7);
        ctx.lineTo(W + 10, -7);
        ctx.stroke();
      }
      break;
    case 6: // chevron at the hoist
      rect(0, 0, W, H / 2, a);
      rect(0, H / 2, W, H / 2, b);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(W * 0.38, H / 2);
      ctx.lineTo(0, H);
      ctx.fill();
      star(ctx, W * 0.12, H / 2, H * 0.1, contrast(c));
      return;
    default: // plain field with a big centred star
      rect(0, 0, W, H, a);
      if (rand() < 0.5) {
        rect(0, 0, W, H * 0.12, b);
        rect(0, H * 0.88, W, H * 0.12, b);
      }
      star(ctx, W / 2, H / 2, H * 0.3, b === a ? c : b);
      return;
  }
  if (rand() < 0.4) star(ctx, W * (design === 1 ? 0.5 : 0.17), H * (design === 0 || design === 3 ? 0.5 : 0.22), H * 0.11, contrast(design === 1 ? b : a));
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
const contrast = (hex: string) => (lum(hex) > 150 ? '#000000' : '#FFFFFF');

/** Map pastels are too pale for a flag: push them towards a saturated dye. */
function deepen(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return '#00247D';
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const min = Math.min(...ch);
  const max = Math.max(...ch);
  const out = ch.map((v) => (max === min ? v * 0.5 : ((v - min) / (max - min)) * 200 + 20));
  return '#' + out.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}
