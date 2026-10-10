// The main colours of a flag, for the "flag colours" look of a country: its land shades from
// the flag's darkest colour on the plains to its lightest on the peaks.

type RGB = [number, number, number];

const cache = new Map<string, string[] | 'loading' | 'failed'>();
const waiting = new Set<() => void>();

/** Called (once per batch) when flags asked for through `flagColors` have been read. */
export function onFlagColors(fn: () => void) {
  waiting.add(fn);
  return () => void waiting.delete(fn);
}

let notify = 0;
function ready() {
  clearTimeout(notify);
  notify = window.setTimeout(() => waiting.forEach((f) => f()), 60);
}

/**
 * The flag's main colours, darkest first (up to three), or null while the image is being read
 * (listeners of `onFlagColors` are told when it is) or when it cannot be.
 */
export function flagColors(url: string | null): string[] | null {
  if (!url) return null;
  const hit = cache.get(url);
  if (hit) return typeof hit === 'string' ? null : hit;
  cache.set(url, 'loading');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      cache.set(url, extract(img));
    } catch {
      cache.set(url, 'failed');
    }
    ready();
  };
  img.onerror = () => cache.set(url, 'failed');
  img.src = url;
  return null;
}

const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const hex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function extract(img: HTMLImageElement): string[] {
  const W = 48;
  const H = 32;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  return palette(ctx.getImageData(0, 0, W, H).data);
}

/** Main colours of RGBA pixels, darkest first: similar shades are merged, small details dropped. */
export function palette(data: ArrayLike<number>): string[] {
  const counts = new Map<number, { n: number; sum: RGB }>();
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const e = counts.get(key) ?? { n: 0, sum: [0, 0, 0] as RGB };
    e.n++;
    e.sum[0] += data[i];
    e.sum[1] += data[i + 1];
    e.sum[2] += data[i + 2];
    counts.set(key, e);
    total++;
  }
  if (!total) return [];
  // Merge near shades (anti-aliased edges, gradients) into the biggest one around.
  const clusters: { n: number; sum: RGB }[] = [];
  for (const e of [...counts.values()].sort((a, b) => b.n - a.n)) {
    const c: RGB = [e.sum[0] / e.n, e.sum[1] / e.n, e.sum[2] / e.n];
    const near = clusters.find((k) => Math.hypot(k.sum[0] / k.n - c[0], k.sum[1] / k.n - c[1], k.sum[2] / k.n - c[2]) < 60);
    if (near) {
      near.n += e.n;
      near.sum = [near.sum[0] + e.sum[0], near.sum[1] + e.sum[1], near.sum[2] + e.sum[2]];
    } else clusters.push({ n: e.n, sum: [...e.sum] });
  }
  return clusters
    .filter((k) => k.n / total >= 0.06)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((k) => [k.sum[0] / k.n, k.sum[1] / k.n, k.sum[2] / k.n] as RGB)
    .sort((a, b) => lum(a) - lum(b))
    .map(hex);
}
