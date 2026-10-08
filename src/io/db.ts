// Local, offline storage of worlds in IndexedDB. Geometry and flags are stored
// apart from the (small, frequently saved) world document.
import Dexie, { type Table } from 'dexie';
import type { RegionGeom, WorldBundle, WorldDoc, WorldMeta } from '../types';
import { renderThumb } from './thumb';
import { uid } from '../util';

interface DocRow { id: string; doc: WorldDoc }
interface GeomRow { id: string; geoms: Record<number, RegionGeom> }
interface FlagRow { world: string; key: string; blob: Blob }
interface ExtraRow { id: string; passthrough: Record<string, Uint8Array> }
interface ThumbRow { id: string; blob: Blob }

class CMapsDB extends Dexie {
  worlds!: Table<WorldMeta, string>;
  docs!: Table<DocRow, string>;
  geoms!: Table<GeomRow, string>;
  flags!: Table<FlagRow, [string, string]>;
  extras!: Table<ExtraRow, string>;
  thumbs!: Table<ThumbRow, string>;

  constructor() {
    super('cmaps');
    this.version(1).stores({
      worlds: '&id, modified',
      docs: '&id',
      geoms: '&id',
      flags: '&[world+key], world',
      extras: '&id',
    });
    this.version(2).stores({ thumbs: '&id' });
  }
}

const db = new CMapsDB();

export async function listWorlds(): Promise<WorldMeta[]> {
  return db.worlds.orderBy('modified').reverse().toArray();
}

function metaOf(doc: WorldDoc): WorldMeta {
  return { ...doc.meta, countries: Object.keys(doc.countries).length, regions: Object.keys(doc.regions).length };
}

export async function saveBundle(b: WorldBundle) {
  const id = b.doc.meta.id;
  await db.transaction('rw', [db.worlds, db.docs, db.geoms, db.flags, db.extras], async () => {
    await db.worlds.put(metaOf(b.doc));
    await db.docs.put({ id, doc: b.doc });
    await db.geoms.put({ id, geoms: b.geoms });
    await db.flags.where('world').equals(id).delete();
    await db.flags.bulkPut(Object.entries(b.flags).map(([key, blob]) => ({ world: id, key, blob })));
    if (b.passthrough) await db.extras.put({ id, passthrough: b.passthrough });
  });
  // The picture is only needed on the home screen: don't make opening the world wait for it.
  void saveThumb(b);
}

/** Re-renders the home-screen picture of a world (best effort: a missing thumbnail only shows a placeholder). */
export async function saveThumb(b: WorldBundle) {
  try {
    const blob = await renderThumb(b);
    if (blob) await db.thumbs.put({ id: b.doc.meta.id, blob });
  } catch (e) {
    console.warn('thumbnail failed', e);
  }
}

export async function loadThumbs(): Promise<Record<string, Blob>> {
  const rows = await db.thumbs.toArray();
  return Object.fromEntries(rows.map((r) => [r.id, r.blob]));
}

/** A full copy of a world under a new id. */
export async function duplicateWorld(id: string, title?: string): Promise<WorldMeta | null> {
  const b = await loadBundle(id);
  if (!b) return null;
  const now = Date.now();
  const meta = { ...b.doc.meta, id: uid(), title: title ?? `${b.doc.meta.title} (copy)`, created: now, modified: now };
  const copy = { ...b, doc: { ...b.doc, meta } };
  await saveBundle(copy);
  return metaOf(copy.doc);
}

export async function saveDoc(doc: WorldDoc) {
  await db.transaction('rw', [db.worlds, db.docs], async () => {
    await db.worlds.put(metaOf(doc));
    await db.docs.put({ id: doc.meta.id, doc });
  });
}

export async function saveGeoms(id: string, geoms: Record<number, RegionGeom>) {
  await db.geoms.put({ id, geoms });
}

export async function saveFlag(world: string, key: string, blob: Blob | null) {
  if (blob) await db.flags.put({ world, key, blob });
  else await db.flags.delete([world, key]);
}

export async function loadBundle(id: string): Promise<WorldBundle | null> {
  const [docRow, geomRow, flagRows, extra] = await Promise.all([
    db.docs.get(id),
    db.geoms.get(id),
    db.flags.where('world').equals(id).toArray(),
    db.extras.get(id),
  ]);
  if (!docRow || !geomRow) return null;
  return {
    doc: docRow.doc,
    geoms: geomRow.geoms,
    flags: Object.fromEntries(flagRows.map((r) => [r.key, r.blob])),
    passthrough: extra?.passthrough,
  };
}

/** Just the world document (no geometry): enough for stats on the home screen. */
export async function loadDoc(id: string): Promise<WorldDoc | null> {
  return (await db.docs.get(id))?.doc ?? null;
}

/** Some of a world's own flag images, by key. */
export async function loadFlags(world: string, keys: string[]): Promise<Record<string, Blob>> {
  const rows = await db.flags.bulkGet(keys.map((k) => [world, k] as [string, string]));
  return Object.fromEntries(rows.filter((r): r is FlagRow => !!r).map((r) => [r.key, r.blob]));
}

export async function deleteWorld(id: string) {
  await db.transaction('rw', [db.worlds, db.docs, db.geoms, db.flags, db.extras, db.thumbs], async () => {
    await db.worlds.delete(id);
    await db.docs.delete(id);
    await db.geoms.delete(id);
    await db.flags.where('world').equals(id).delete();
    await db.extras.delete(id);
    await db.thumbs.delete(id);
  });
}

export async function renameWorld(id: string, title: string) {
  const row = await db.docs.get(id);
  if (!row) return;
  row.doc.meta.title = title;
  await saveDoc(row.doc);
}

function pref(key: string) {
  return {
    get: () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set: (id: string | null) => {
      try {
        if (id) localStorage.setItem(key, id);
        else localStorage.removeItem(key);
      } catch {
        /* private mode */
      }
    },
  };
}

/** The world reopened on start-up. */
export const lastWorld = pref('cmaps:last-world');
/** The world pinned at the top of the home screen (defaults to the most recently edited one). */
export const mainWorld = pref('cmaps:main-world');

/** Space used / available for this site's storage, when the browser tells. */
export async function storageUsage(): Promise<{ used: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e?.usage != null && e.quota ? { used: e.usage, quota: e.quota } : null;
  } catch {
    return null;
  }
}
