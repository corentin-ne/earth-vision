// Paints one map tile of the cloud deck: fractal noise sampled on the sphere (so it has no seams
// and no stretching at the poles), with more cloud along the storm tracks and the equator and
// clear skies over the subtropical deserts.

const SIZE = 256;
/** How far a cloud's shadow falls, in pixels of the tile. */
const SHADOW = 4;

function hash(x: number, y: number, z: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  // The eight corners, blended along x, then y, then z (written out: this runs millions of times).
  const c000 = hash(xi, yi, zi), c100 = hash(xi + 1, yi, zi), c010 = hash(xi, yi + 1, zi), c110 = hash(xi + 1, yi + 1, zi);
  const c001 = hash(xi, yi, zi + 1), c101 = hash(xi + 1, yi, zi + 1), c011 = hash(xi, yi + 1, zi + 1), c111 = hash(xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

function fbm(x: number, y: number, z: number, oct: number) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * noise(x * f, y * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s / (1 - 0.5 ** oct);
}

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

function cover(lat: number) {
  const a = Math.abs(lat);
  return 0.4 + 0.2 * Math.exp(-(((a - 55) / 14) ** 2)) + 0.12 * Math.exp(-((lat / 7) ** 2)) - 0.14 * Math.exp(-(((a - 24) / 9) ** 2));
}

// The last point's cover and thickness, read right after `cloud()` (no object per pixel).
let outAlpha = 0, outThick = 0;
const F = 3.2;

/** Cloud cover and thickness at a point: fractal noise warped twice into swirls and eddies. */
function cloud(cl: number, sl: number, cosLng: number, sinLng: number, cov: number, oct: number) {
  const a = cl * cosLng * F, b = cl * sinLng * F, c = sl * F;
  const qx = fbm(a + 5.2, b + 1.3, c, 4) - 0.5, qy = fbm(a + 1.7, b + 9.2, c + 3.1, 4) - 0.5, qz = fbm(a + 8.3, b + 2.8, c + 6.4, 4) - 0.5;
  const rx = fbm(a + 3 * qx + 1.7, b + 3 * qy + 9.2, c + 3 * qz, 3) - 0.5;
  const ry = fbm(a + 3 * qx + 8.3, b + 3 * qy + 2.8, c + 3 * qz + 4.4, 3) - 0.5;
  let v = fbm(a + 2.2 * rx, b + 2.2 * ry, c + 2.2 * (rx - ry), oct);
  v = (v - 0.5) * 2.3 + 0.5;
  const d = v - (1 - cov);
  outAlpha = smooth(-0.08, 0.3, d);
  outThick = smooth(0.12, 0.5, d);
}

self.onmessage = async (e: MessageEvent<{ id: number; z: number; x: number; y: number }>) => {
  const { id, z, x, y } = e.data;
  try {
    const px = new Uint8ClampedArray(SIZE * SIZE * 4);
    const n = 2 ** z;
    // Finer detail the closer the tile.
    const oct = Math.min(8, 5 + z);
    // The clouds are worked out with a margin, so each can cast its shadow a few pixels to the
    // south-east, onto the land below, even across the tile's edge.
    const M = SHADOW;
    const S2 = SIZE + M;
    const al = new Float32Array(S2 * S2), th = new Float32Array(S2 * S2);
    // Longitude only changes along a row, latitude only down a column: their sines once each.
    const cosLng = new Float64Array(S2), sinLng = new Float64Array(S2);
    for (let i = 0; i < S2; i++) {
      const lng = ((x + (i - M + 0.5) / SIZE) / n) * 2 * Math.PI - Math.PI;
      cosLng[i] = Math.cos(lng);
      sinLng[i] = Math.sin(lng);
    }
    for (let j = 0; j < S2; j++) {
      const my = (y + (j - M + 0.5) / SIZE) / n;
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * Math.min(0.9999, Math.max(0.0001, my)))));
      const cl = Math.cos(lat), sl = Math.sin(lat), cov = cover((lat * 180) / Math.PI);
      for (let i = 0; i < S2; i++) {
        cloud(cl, sl, cosLng[i], sinLng[i], cov, oct);
        al[j * S2 + i] = outAlpha;
        th[j * S2 + i] = outThick;
      }
    }
    for (let j = 0; j < SIZE; j++)
      for (let i = 0; i < SIZE; i++) {
        const k = (j + M) * S2 + (i + M);
        const a = al[k] * (0.75 + 0.25 * th[k]);
        // The shadow of the cloud up and to the left of this pixel.
        const sh = al[j * S2 + i] * 0.32;
        // A white cloud over its own dark shadow, as one colour and one opacity.
        const A = a + sh * (1 - a);
        const o = (j * SIZE + i) * 4;
        if (A <= 0.002) continue;
        const c = 255 - 40 * th[k];
        const mix = (top: number, shadow: number) => (top * a + shadow * sh * (1 - a)) / A;
        px[o] = mix(c, 18);
        px[o + 1] = mix(c + 3, 30);
        px[o + 2] = mix(c + 8, 52);
        px[o + 3] = 255 * A;
      }
    const cv = new OffscreenCanvas(SIZE, SIZE);
    cv.getContext('2d')!.putImageData(new ImageData(px, SIZE, SIZE), 0, 0);
    const buf = await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer();
    (self as unknown as Worker).postMessage({ id, buf }, [buf]);
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message });
  }
};
