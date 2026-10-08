// Small flat (equirectangular) picture of a world, shown on the home screen.
import type { Position } from 'geojson';
import type { WorldBundle } from '../types';

const W = 960;
const H = 480;
const UNCLAIMED = '#E9E4D6';
// Antarctica and the far north are mostly empty: crop them so the land fills the card.
const NORTH = 84;
const SOUTH = -58;

/** Renders a PNG thumbnail of the world's countries; null where no canvas is available (tests, old browsers). */
export async function renderThumb(b: WorldBundle): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const sea = ctx.createLinearGradient(0, 0, 0, H);
  sea.addColorStop(0, '#9fc9e4');
  sea.addColorStop(0.5, '#b9dcef');
  sea.addColorStop(1, '#9fc9e4');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, W, H);

  const x = (lng: number) => ((lng + 180) / 360) * W;
  const y = (lat: number) => ((NORTH - lat) / (NORTH - SOUTH)) * H;
  const ring = (r: Position[]) => {
    for (let i = 0; i < r.length; i++) {
      const px = x(r[i][0]);
      const py = y(r[i][1]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };

  // Group regions by colour: one path per colour is much faster than one per region.
  const byColor = new Map<string, number[]>();
  for (const r of Object.values(b.doc.regions)) {
    const color = b.doc.countries[r.cid]?.color ?? UNCLAIMED;
    let list = byColor.get(color);
    if (!list) byColor.set(color, (list = []));
    list.push(r.id);
  }
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.6;
  for (const [color, ids] of byColor) {
    ctx.beginPath();
    for (const id of ids) {
      const g = b.geoms[id];
      if (!g) continue;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      for (const p of polys) for (const r of p) ring(r);
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = color; // hides hairline gaps between neighbouring regions
    ctx.fill('evenodd');
    ctx.stroke();
  }

  // A soft vignette makes the flat map read as a "card".
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(10,20,40,0.28)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  return canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
}
