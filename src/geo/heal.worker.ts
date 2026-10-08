import { healGeoms } from './heal';
import type { RegionGeom } from '../types';

self.onmessage = (e: MessageEvent<{ geoms: Record<number, RegionGeom>; tol: number }>) => {
  try {
    self.postMessage({ ok: true, fixed: healGeoms(e.data.geoms, e.data.tol) });
  } catch (err) {
    self.postMessage({ ok: false, error: (err as Error).message });
  }
};
