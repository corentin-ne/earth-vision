// Reader for the old CMaps project backups (.cmaps): a zip holding the world as JSON
// plus flag images and, for worlds imported from A+, the original A+ files.
// Earth Vision now saves everything as .map (see amap.ts); this only keeps old backups openable.
import { unzipSync, strFromU8 } from 'fflate';
import type { RegionGeom, WorldBundle, WorldDoc } from '../types';
import { uid } from '../util';

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif' };

export function importProject(bytes: Uint8Array): WorldBundle {
  const files = unzipSync(bytes);
  const world = JSON.parse(strFromU8(files['world.json'])) as { format: string; doc: WorldDoc };
  if (world.format !== 'cmaps') throw new Error('Not a CMaps project file');
  const geoms = JSON.parse(strFromU8(files['geoms.json'])) as Record<number, RegionGeom>;
  const flags: Record<string, Blob> = {};
  const passthrough: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(files)) {
    const m = /^flags\/(.+)\.(\w+)$/.exec(path);
    if (m) flags[decodeURIComponent(m[1])] = new Blob([data as BlobPart], { type: MIME[m[2].toLowerCase()] ?? 'image/png' });
    else if (path.startsWith('amap/') && !path.endsWith('/')) passthrough[path.slice(5)] = data;
  }
  // A fresh id so importing the same file twice gives two separate worlds.
  const doc = { ...world.doc, meta: { ...world.doc.meta, id: uid(), modified: Date.now() } };
  return { doc, geoms, flags, passthrough: Object.keys(passthrough).length ? passthrough : undefined };
}
