// Flags come in every proportion, and some are not rectangles at all (Nepal, pennants, a flag
// ringed with flames): each image is measured once so it can be shown as it is, framed only
// when it really is a rectangle.
import { useEffect, useState } from 'react';

export interface FlagShapeInfo {
  /** Width / height of the image. */
  ratio: number;
  /** Has see-through parts along its outline: drawn without a frame, with a shadow that follows it. */
  shaped: boolean;
}

export const RECT: FlagShapeInfo = { ratio: 1.5, shaped: false };

const known = new Map<string, FlagShapeInfo>();
const pending = new Map<string, Promise<FlagShapeInfo>>();

/** Measures a loaded image. */
export function measureImage(img: HTMLImageElement): FlagShapeInfo {
  const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1.5;
  let shaped = false;
  try {
    const S = 48;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, S, S);
    const d = ctx.getImageData(0, 0, S, S).data;
    let clear = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 128) clear++;
    shaped = clear / (S * S) > 0.015;
  } catch {
    /* tainted canvas: treat as a rectangle */
  }
  return { ratio, shaped };
}

/** The shape of the flag image at `url` (measured once, then cached). */
export function flagShape(url: string): Promise<FlagShapeInfo> {
  const hit = known.get(url);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(url);
  if (!p) {
    p = new Promise<FlagShapeInfo>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(measureImage(img));
      img.onerror = () => resolve(RECT);
      img.src = url;
    }).then((info) => {
      known.set(url, info);
      pending.delete(url);
      return info;
    });
    pending.set(url, p);
  }
  return p;
}

/** The flag's shape for rendering: a 3:2 rectangle until the image has been measured. */
export function useFlagShape(url: string | null): FlagShapeInfo {
  const [info, setInfo] = useState<FlagShapeInfo>(() => (url && known.get(url)) || RECT);
  useEffect(() => {
    if (!url) return setInfo(RECT);
    const hit = known.get(url);
    if (hit) return setInfo(hit);
    let live = true;
    flagShape(url).then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [url]);
  return info;
}
