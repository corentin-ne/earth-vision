import type { Era, WorldDoc } from '../types';
import { useWorld, commit, emitChange, toast, type ChangeSet } from './store';
import { captureEra, eraDoc, restorePatch, sortedEras } from './eras';
import { uid } from '../util';

// The timeline of the open world: chapters taken from it, looked back at, replayed, returned to.

const get = useWorld.getState;
const set = useWorld.setState;

/** The world as it is now, whatever the map shows. */
function present(): WorldDoc | null {
  const s = get();
  return s.present ?? s.doc;
}

/** What differs between two views of the same world, for the map to redraw just that. */
function diff(a: WorldDoc, b: WorldDoc): ChangeSet {
  const regions = new Set<number>();
  const countries = new Set<string>();
  for (const r of Object.values(b.regions)) {
    const o = a.regions[r.id];
    if (o === r || (o && o.cid === r.cid && o.occ === r.occ)) continue;
    regions.add(r.id);
    if (o?.cid) countries.add(o.cid);
    if (r.cid) countries.add(r.cid);
  }
  for (const cid of new Set([...Object.keys(a.countries), ...Object.keys(b.countries)])) {
    const x = a.countries[cid];
    const y = b.countries[cid];
    if (x === y) continue;
    if (!x || !y || x.name !== y.name || x.color !== y.color || x.flag !== y.flag || x.colorMode !== y.colorMode || x.overlord !== y.overlord || String(x.gradient) !== String(y.gradient) || String(x.label) !== String(y.label))
      countries.add(cid);
  }
  return { regions, countries, cities: false, geoms: false, alliances: !!get().allianceView, marks: false, all: false };
}

/** Shows a chapter on the map (read-only), or the present again with `null`. */
export function viewChapter(id: string | null) {
  const s = get();
  const now = present();
  if (!now || !s.doc || (id ?? null) === s.era) return;
  const era = id ? now.timeline?.find((e) => e.id === id) : null;
  if (id && !era) return;
  // The camera stays where it is.
  const next: WorldDoc = { ...(era ? eraDoc(now, era) : now), view: s.doc.view };
  const changes = diff(s.doc, next);
  set({
    doc: next,
    present: era ? { ...now, view: s.doc.view } : null,
    era: era ? era.id : null,
    selection: { cid: null, regions: [], city: null },
    detailsOpen: false,
    markSel: null,
    snap: null,
    ...(era ? { tool: s.tool === 'measure' ? 'measure' : 'select' } : {}),
  });
  emitChange(changes);
}

/** Runs an edit of the timeline on the present even while a chapter is shown, keeping that chapter on the map. */
function onPresent(fn: () => void) {
  const s = get();
  if (!s.present) return fn();
  const id = s.era;
  set({ doc: s.present, present: null });
  try {
    fn();
  } finally {
    const now = get().doc!;
    const era = now.timeline?.find((e) => e.id === id);
    if (era) set({ doc: { ...eraDoc(now, era), view: s.doc?.view }, present: now });
    else set({ doc: s.doc, present: now });
  }
}

/** Keeps the world as it is now as a new chapter, after the others. Returns its id. */
export function addChapter(name?: string, date = ''): string | null {
  viewChapter(null);
  const doc = get().doc;
  if (!doc) return null;
  const eras = sortedEras(doc);
  const id = uid();
  const era = captureEra(doc, { id, name: name?.trim() || `Chapter ${eras.length + 1}`, date, order: (eras[eras.length - 1]?.order ?? 0) + 1 });
  commit(`Add ${era.name} to the timeline`, { timeline: { [id]: era } });
  return id;
}

export function updateChapter(id: string, changes: Partial<Pick<Era, 'name' | 'date' | 'notes'>>) {
  onPresent(() => {
    const era = get().doc?.timeline?.find((e) => e.id === id);
    if (!era) return;
    const next = { ...era, ...changes };
    if (!next.notes) delete next.notes;
    commit('Edit chapter', { timeline: { [id]: next } }, { group: `era:${id}:${Object.keys(changes).join(',')}` });
  });
}

/** Moves a chapter one place earlier (-1) or later (1). */
export function moveChapter(id: string, dir: -1 | 1) {
  onPresent(() => {
    const eras = sortedEras(get().doc);
    const i = eras.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= eras.length) return;
    commit('Reorder the timeline', { timeline: { [eras[i].id]: { ...eras[i], order: eras[j].order }, [eras[j].id]: { ...eras[j], order: eras[i].order } } });
  });
}

/** Replaces what a chapter remembers by the world as it is now. */
export function recaptureChapter(id: string) {
  viewChapter(null);
  const doc = get().doc;
  const era = doc?.timeline?.find((e) => e.id === id);
  if (!doc || !era) return;
  commit(`Update ${era.name}`, { timeline: { [id]: captureEra(doc, era) } });
  toast(`${era.name} now holds the world as it is`, 'ok');
}

export function deleteChapter(id: string) {
  if (get().era === id) viewChapter(null);
  onPresent(() => {
    const era = get().doc?.timeline?.find((e) => e.id === id);
    if (era) commit(`Remove ${era.name} from the timeline`, { timeline: { [id]: null } });
  });
}

/** Brings the world back to a chapter: its borders, occupations and countries (one undo step). */
export function restoreChapter(id: string) {
  viewChapter(null);
  const doc = get().doc;
  const era = doc?.timeline?.find((e) => e.id === id);
  if (!doc || !era) return;
  const patch = restorePatch(doc, era);
  if (!patch.regions && !patch.countries) return toast('The world is already as it was then');
  commit(`Return to ${era.name}`, patch);
  toast(`The world is back to ${era.name} · Ctrl+Z undoes it`, 'ok');
}

/** The chapter before (-1) or after (1) the one shown; past the last one comes the present. */
export function stepChapter(dir: -1 | 1): boolean {
  const eras = sortedEras(present());
  if (!eras.length) return false;
  const i = get().era ? eras.findIndex((e) => e.id === get().era) : eras.length;
  const j = i + dir;
  if (j < 0 || j > eras.length) return false;
  viewChapter(j === eras.length ? null : eras[j].id);
  return true;
}
