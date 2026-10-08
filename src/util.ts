import { isNative, saveFileNative } from './native';

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const nf = new Intl.NumberFormat('en-US');
export const fmtInt = (n: number): string => nf.format(Math.round(n));

/** 1234567 → "1.23 M" */
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + ' T';
  if (a >= 1e9) return (n / 1e9).toFixed(2) + ' B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + ' M';
  if (a >= 1e4) return (n / 1e3).toFixed(1) + ' k';
  return fmtInt(n);
}

export const fmtArea = (km2: number): string => `${fmtInt(km2)} km²`;

export async function download(data: Blob | Uint8Array | string, filename: string, type = 'application/octet-stream'): Promise<void> {
  if (isNative) return saveFileNative(data, filename);
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.flush = (...args: A) => {
    clearTimeout(t);
    fn(...args);
  };
  return d;
}

const rtf = typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null;
/** 1700000000000 → "5 minutes ago" */
export function fmtAgo(ts: number, now = Date.now()): string {
  const s = Math.round((ts - now) / 1000);
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.35, 'week'],
    [12, 'month'],
    [Infinity, 'year'],
  ];
  let v = s;
  for (const [n, unit] of steps) {
    if (Math.abs(v) < n) {
      if (unit === 'second') return 'just now';
      return rtf ? rtf.format(Math.round(v), unit) : new Date(ts).toLocaleString();
    }
    v /= n;
  }
  return new Date(ts).toLocaleString();
}

export const fmtBytes = (n: number): string =>
  n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(0) + ' MB' : n >= 1e3 ? (n / 1e3).toFixed(0) + ' kB' : n + ' B';
