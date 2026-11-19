// Making the sea-level slider permanent: land the lowered sea uncovers becomes new regions
// (given to the country whose coast they touch), land the raised sea reaches is cut off and
// sunk. The shapes come from the same tiles the map shows: the sea floor (bathy) and the
// height the sea must reach to flood each spot (flood, see scripts/build-sealevel.py).
import { contours } from 'd3-contour';
import { difference, intersection, union, type Geom } from 'polyclip-ts';
import type { LngLat, RegionGeom } from '../types';
import { asset } from '../map/style';
import { bbox, geomArea, labelPoint, pointInGeom } from '../geo/engine';
import { addLand } from './edits';
import { commit, cutRegions, endGroup, engine, toast, transferRegions, useWorld } from './store';
import { uid } from '../util';

const get = useWorld.getState;

interface Grid {
  w: number;
  h: number;
  data: Float32Array;
}

/** A whole zoom level of terrarium tiles decoded into one mercator grid of heights. */
async function loadGrid(kind: 'bathy' | 'flood', z: number, missing: number): Promise<Grid> {
  const n = 1 << z;
  const T = 256;
  const w = n * T;
  const data = new Float32Array(w * w).fill(missing);
  const ext = kind === 'bathy' ? 'png' : 'webp';
  const canvas = new OffscreenCanvas(T, T);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const jobs: Promise<void>[] = [];
  for (let x = 0; x < n; x++)
    for (let y = 0; y < n; y++)
      jobs.push(
        fetch(asset(`tiles/${kind}/${z}/${x}/${y}.${ext}`))
          .then((r) => (r.ok ? r.blob() : Promise.reject()))
          .then((b) => createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
          .then((img) => {
            ctx.clearRect(0, 0, T, T);
            ctx.drawImage(img, 0, 0);
            const px = ctx.getImageData(0, 0, T, T).data;
            for (let j = 0; j < T; j++)
              for (let i = 0; i < T; i++) {
                const k = (j * T + i) * 4;
                data[(y * T + j) * w + x * T + i] = px[k] * 256 + px[k + 1] + px[k + 2] / 256 - 32768;
              }
          })
          .catch(() => {}),
      );
  await Promise.all(jobs);
  return { w, h: w, data };
}

/** Douglas–Peucker on a closed ring (grid units). */
function simplify(ring: number[][], tol: number): number[][] {
  if (ring.length < 8) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  // A closed ring has the same first and last point: split it at its farthest point first.
  let far = 0;
  let fd = -1;
  for (let i = 1; i < ring.length - 1; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > fd) [fd, far] = [d, i];
  }
  keep[far] = 1;
  stack.length = 0;
  stack.push([0, far], [far, ring.length - 1]);
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const len = Math.hypot(bx - ax, by - ay) || 1e-9;
    let best = -1;
    let bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - ring[i][1]) - (ax - ring[i][0]) * (by - ay)) / len;
      if (d > bd) [bd, best] = [d, i];
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

/**
 * Polygons (lng/lat) where `mask` is set, simplified, without specks. The grid is traced in
 * windows so a whole zoom level never needs one huge buffer; a shape crossing a window edge
 * comes out as pieces that meet exactly along it (and pieces on an edge are kept, however
 * small, so no sliver is left between them).
 */
async function shapes(g: Grid, mask: Uint8Array, minKm2: number, win = 1024): Promise<RegionGeom[]> {
  const lng = (x: number) => (x / g.w) * 360 - 180;
  const lat = (y: number) => Math.max(-84, Math.min(84, (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / g.h))) * 180) / Math.PI));
  const out: RegionGeom[] = [];
  for (let y0 = 0; y0 < g.h; y0 += win)
    for (let x0 = 0; x0 < g.w; x0 += win) {
      const ww = Math.min(win, g.w - x0);
      const wh = Math.min(win, g.h - y0);
      const vals = new Float32Array(ww * wh);
      let any = false;
      for (let j = 0; j < wh; j++)
        for (let i = 0; i < ww; i++)
          if (mask[(y0 + j) * g.w + x0 + i]) {
            vals[j * ww + i] = 1;
            any = true;
          }
      if (!any) continue;
      const [mp] = contours().size([ww, wh]).thresholds([0.5])(vals as unknown as number[]);
      for (const poly of mp.coordinates) {
        const edge = poly[0].some(([x, y]) => x <= 0.5 || y <= 0.5 || x >= ww - 0.5 || y >= wh - 0.5);
        const rings = poly.map((r) => simplify(r, 0.7).map(([x, y]) => [+lng(x0 + x).toFixed(4), +lat(y0 + y).toFixed(4)]));
        const geom: RegionGeom = { type: 'Polygon', coordinates: rings };
        if (rings[0].length >= 4 && (edge || geomArea(geom) >= minKm2)) out.push(geom);
      }
      await yieldUi();
    }
  return out;
}

/** Counts of set cells in any rectangle of the mask, in constant time (summed-area table over 4×4 blocks). */
function blockCounts(g: Grid, mask: Uint8Array, block = 4) {
  const bw = Math.ceil(g.w / block);
  const bh = Math.ceil(g.h / block);
  const sat = new Uint32Array((bw + 1) * (bh + 1));
  for (let by = 0; by < bh; by++) {
    let row = 0;
    for (let bx = 0; bx < bw; bx++) {
      let c = 0;
      for (let j = by * block; j < Math.min(g.h, (by + 1) * block); j++) for (let i = bx * block; i < Math.min(g.w, (bx + 1) * block); i++) c += mask[j * g.w + i];
      row += c;
      sat[(by + 1) * (bw + 1) + bx + 1] = sat[by * (bw + 1) + bx + 1] + row;
    }
  }
  const toX = (lng: number) => Math.max(0, Math.min(bw, Math.floor((((lng + 180) / 360) * g.w) / block)));
  const toY = (lat: number) => {
    const y = (0.5 - Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360)) / (2 * Math.PI)) * g.h;
    return Math.max(0, Math.min(bh, Math.floor(y / block)));
  };
  /** Set cells inside a lng/lat box (rounded out to whole blocks). */
  return ([w, s, e, n]: [number, number, number, number]) => {
    const x0 = toX(w);
    const x1 = Math.min(bw, toX(e) + 1);
    const y0 = toY(n);
    const y1 = Math.min(bh, toY(s) + 1);
    return sat[y1 * (bw + 1) + x1] - sat[y0 * (bw + 1) + x1] - sat[y1 * (bw + 1) + x0] + sat[y0 * (bw + 1) + x0];
  };
}

const yieldUi = () => new Promise((r) => setTimeout(r, 0));

/** Morphological opening with a 3×3 square, in place: specks and one-cell-wide strips go, the rest keeps its shape. */
export function open(mask: Uint8Array, w: number, h: number) {
  const tmp = new Uint8Array(mask.length);
  // Erode: a cell stays only if its whole 3×3 neighbourhood is set.
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      tmp[i] = mask[i] & mask[i - 1] & mask[i + 1] & mask[i - w] & mask[i + w] & mask[i - w - 1] & mask[i - w + 1] & mask[i + w - 1] & mask[i + w + 1];
    }
  // Dilate back: a cell is set if any of its 3×3 neighbourhood survived.
  mask.fill(0);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!tmp[i]) continue;
      mask[i - w - 1] = mask[i - w] = mask[i - w + 1] = mask[i - 1] = mask[i] = mask[i + 1] = mask[i + w - 1] = mask[i + w] = mask[i + w + 1] = 1;
    }
}

/**
 * Turns the sea level shown on the map into the world itself, as one undo step. Returns how
 * many regions were raised, cut or sunk. `progress` hears what is being done (0–1).
 */
export async function freezeSeaLevel(level: number, progress: (f: number) => void = () => {}): Promise<number> {
  if (!get().doc || !level) return 0;
  const group = 'sea-' + uid();
  const n = level < 0 ? await lowerSea(level, group, progress) : await raiseSea(level, group, progress);
  endGroup();
  useWorld.setState({ seaLevel: 0 });
  return n;
}

async function lowerSea(level: number, group: string, progress: (f: number) => void): Promise<number> {
  const g = await loadGrid('bathy', 3, 0);
  progress(0.1);
  // Sea floor above the new level, reaching one cell into today's land so the new ground
  // meets the coast (addLand keeps only the part that isn't land yet).
  const { w, data } = g;
  const up = (i: number) => data[i] < 0 && data[i] >= level;
  const mask = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++)
    mask[i] = up(i) || (data[i] >= 0 && ((i % w > 0 && up(i - 1)) || (i % w < w - 1 && up(i + 1)) || (i >= w && up(i - w)) || (i + w < data.length && up(i + w)))) ? 1 : 0;
  const polys = (await shapes(g, mask, 800)).sort((a, b) => geomArea(b) - geomArea(a));
  progress(0.3);
  let made = 0;
  const label = `Lower the sea by ${-level} m`;
  for (const [k, p] of polys.entries()) {
    const ring = (p.type === 'Polygon' ? p.coordinates[0] : []) as LngLat[];
    const id = addLand(ring, '', { group, quiet: true, label });
    if (id != null) {
      made++;
      // The new land joins the country whose coast it touches most.
      const doc = get().doc!;
      const count: Record<string, number> = {};
      for (const nb of engine.neighbors(id)) {
        const cid = doc.regions[nb]?.cid;
        if (cid) count[cid] = (count[cid] ?? 0) + 1;
      }
      const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (best) transferRegions([id], best, { group, label });
    }
    if (k % 5 === 0) {
      progress(0.3 + (0.7 * k) / polys.length);
      await yieldUi();
    }
  }
  return made;
}

async function raiseSea(level: number, group: string, progress: (f: number) => void): Promise<number> {
  const g = await loadGrid('flood', 4, -100);
  progress(0.05);
  // Land whose spill height the sea now passes (the sea itself is -100).
  const mask = new Uint8Array(g.data.length);
  for (let i = 0; i < mask.length; i++) mask[i] = g.data[i] > -50 && g.data[i] < level ? 1 : 0;
  // The elevation data and the regions never agree to the cell on where the coast is: a band
  // one cell wide along every shore would be "flooded" and nibble every coastal region. An
  // opening (erode, then grow back) keeps only floods at least two cells across.
  open(mask, g.w, g.h);
  const wetIn = blockCounts(g, mask);
  const wet = await shapes(g, mask, 150);
  progress(0.25);
  if (!wet.length) return 0;
  const boxes = wet.map((p) => bbox(p));
  const { doc, geoms } = get();
  if (!doc) return 0;
  const pieces = new Map<number, RegionGeom[]>();
  const sink: number[] = [];
  // Only regions with flooded cells under them are worth clipping.
  const todo = Object.values(doc.regions).filter((r) => geoms[r.id] && wetIn(bbox(geoms[r.id])) > 0);
  for (const [k, r] of todo.entries()) {
    const geom = geoms[r.id];
    const b = bbox(geom);
    const near = wet.filter((_, i) => boxes[i][0] <= b[2] && boxes[i][2] >= b[0] && boxes[i][1] <= b[3] && boxes[i][3] >= b[1]);
    if (near.length) {
      const subject = (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates) as Geom;
      const water = near.map((p) => (p.type === 'Polygon' ? [p.coordinates] : p.coordinates)) as Geom[];
      try {
        // The water near this region as one shape (pieces from neighbouring windows meet along their edges).
        const sea = water.length > 1 ? union(water[0], ...water.slice(1)) : water[0];
        const drowned = intersection(subject, sea);
        const wetGeom = drowned.length ? toGeom(drowned) : null;
        if (wetGeom) {
          const dryGeom = toGeom(difference(subject, sea));
          if (!dryGeom || geomArea(dryGeom) < geomArea(geom) * 0.03) sink.push(r.id);
          else if (geomArea(wetGeom) > Math.min(geomArea(geom) * 0.03, 400)) pieces.set(r.id, [dryGeom, wetGeom]);
        }
      } catch (e) {
        console.warn('could not cut region', r.id, e);
      }
    }
    if (k % 10 === 0) {
      progress(0.25 + (0.65 * k) / todo.length);
      await yieldUi();
    }
  }
  const label = `Raise the sea by ${level} m`;
  const cut = cutRegions([...pieces.keys()], (_, r) => pieces.get(r.id) ?? null, { label, group });
  progress(0.95);
  // The drowned piece of each region cut is the one lying in the water.
  const now = get().geoms;
  for (const pids of Object.values(cut))
    for (const pid of pids) {
      const lp = labelPoint(now[pid]);
      if (lp && wet.some((p) => pointInGeom(lp, p))) sink.push(pid);
    }
  if (sink.length) {
    const regions: Record<number, null> = {};
    const gs: Record<number, null> = {};
    for (const id of sink) {
      regions[id] = null;
      gs[id] = null;
    }
    commit(label, { regions, geoms: gs }, { group });
  }
  if (!sink.length && !Object.keys(cut).length) toast('The sea reaches no land at this level');
  return sink.length + Object.keys(cut).length;
}

function toGeom(mp: [number, number][][][]): RegionGeom | null {
  const polys = mp.filter((p) => p.length && p[0].length >= 4);
  if (!polys.length) return null;
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
}
