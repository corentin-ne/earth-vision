// Local, offline storage of worlds in IndexedDB. Geometry and flags are stored
// apart from the (small, frequently saved) world document.
import Dexie, { type Table } from 'dexie';
import type { RegionGeom, WorldBundle, WorldDoc, WorldMeta } from '../types';

interface DocRow { id: string; doc: WorldDoc }
interface GeomRow { id: string; geoms: Record<number, RegionGeom> }
interface FlagRow { world: string; key: string; blob: Blob }
interface ExtraRow { id: string; passthrough: Record<string, Uint8Array> }

class CMapsDB extends Dexie {
  worlds!: Table<WorldMeta, string>;
  docs!: Table<DocRow, string>;
  geoms!: Table<GeomRow, string>;
  flags!: Table<FlagRow, [string, string]>;
  extras!: Table<ExtraRow, string>;

  constructor() {
    super('cmaps');
    this.version(1).stores({
      worlds: '&id, modified',
      docs: '&id',
      geoms: '&id',
      flags: '&[world+key], world',
      extras: '&id',
    });
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

export async function deleteWorld(id: string) {
  await db.transaction('rw', [db.worlds, db.docs, db.geoms, db.flags, db.extras], async () => {
    await db.worlds.delete(id);
    await db.docs.delete(id);
    await db.geoms.delete(id);
    await db.flags.where('world').equals(id).delete();
    await db.extras.delete(id);
  });
}

export async function renameWorld(id: string, title: string) {
  const row = await db.docs.get(id);
  if (!row) return;
  row.doc.meta.title = title;
  await saveDoc(row.doc);
}

const LAST = 'cmaps:last-world';
export const lastWorld = {
  get: () => {
    try {
      return localStorage.getItem(LAST);
    } catch {
      return null;
    }
  },
  set: (id: string | null) => {
    try {
      if (id) localStorage.setItem(LAST, id);
      else localStorage.removeItem(LAST);
    } catch {
      /* private mode */
    }
  },
};
