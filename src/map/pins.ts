// Map pins: a teardrop marker with a symbol, drawn on a canvas once per symbol and colour.

export const PINS: Record<string, { glyph: string; label: string; color: string }> = {
  star: { glyph: '★', label: 'Place of interest', color: '#e0a21b' },
  battle: { glyph: '⚔', label: 'Battle', color: '#c0392b' },
  treaty: { glyph: '✍', label: 'Treaty', color: '#2e7d5b' },
  castle: { glyph: '♜', label: 'Fortress', color: '#5b5f6b' },
  ruin: { glyph: '⌂', label: 'Ruins', color: '#8d6e4f' },
  temple: { glyph: '✦', label: 'Temple', color: '#7a4fb8' },
  port: { glyph: '⚓', label: 'Port', color: '#1f6fb8' },
  mine: { glyph: '⚒', label: 'Mine', color: '#6d4c2e' },
  flag: { glyph: '⚑', label: 'Landmark', color: '#d0312d' },
  skull: { glyph: '☠', label: 'Disaster', color: '#2b2b3d' },
};

export function drawPin(icon: string, color?: string): ImageData {
  const p = PINS[icon] ?? PINS.star;
  const W = 44;
  const H = 56;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const r = 17;
  const cx = W / 2;
  const cy = r + 3;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.8, Math.PI * 0.2);
  ctx.lineTo(cx, H - 3);
  ctx.closePath();
  ctx.fillStyle = color ?? p.color;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 20px "Segoe UI Symbol", "Noto Sans Symbols 2", "Apple Symbols", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(p.glyph, cx, cy + 1);
  return ctx.getImageData(0, 0, W, H);
}
