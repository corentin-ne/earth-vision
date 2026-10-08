// Opening and saving world files.
import type { WorldBundle } from '../types';
import { exportAmap, importAmap, isAmap } from './amap';
import { importProject } from './project';
import { download } from '../util';

/** Reads a .map (or an old .cmaps backup) into a new world. */
export async function readWorldFile(file: File): Promise<WorldBundle> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isAmap(bytes)) return importAmap(bytes, file.name);
  if (/\.cmaps$/i.test(file.name)) return importProject(bytes);
  // A .map that was re-zipped by hand, or a .cmaps with another name: sniff the content.
  try {
    return importProject(bytes);
  } catch {
    return importAmap(bytes, file.name);
  }
}

/** A file-system friendly name for a world. */
export const fileBase = (title: string) => title.replace(/[^\p{L}\p{N}\- _'()]+/gu, '').trim() || 'world';

/** Downloads the world as an A+ compatible .map file. */
export async function downloadMap(b: WorldBundle) {
  await download(await exportAmap(b), `${fileBase(b.doc.meta.title)}.map`);
}
