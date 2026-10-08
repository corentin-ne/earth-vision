import { useWorld } from './store';
import { saveDoc, saveFlag, saveGeoms } from '../io/db';
import { debounce } from '../util';

let flushNow: () => Promise<void> = () => Promise.resolve();
const savedListeners = new Set<(saving: boolean) => void>();

/** Writes pending changes right away (before closing a world, on Ctrl+S…). */
export function flushAutosave(): Promise<void> {
  return flushNow();
}

/** Tells when the open world has unsaved changes (true) and when they are stored (false). */
export function onSaveState(fn: (pending: boolean) => void) {
  savedListeners.add(fn);
  return () => void savedListeners.delete(fn);
}
const emitSave = (pending: boolean) => savedListeners.forEach((f) => f(pending));

/** Autosaves the open world to IndexedDB: the document on every change, geometry and flags only when they change. */
export function startAutosave() {
  let savedGeomVersion = useWorld.getState().geomVersion;
  let savedFlags = new Set(Object.keys(useWorld.getState().flags));
  let worldId = useWorld.getState().doc?.meta.id ?? null;
  let saving: Promise<void> = Promise.resolve();

  const flush = debounce(() => {
    const s = useWorld.getState();
    if (!s.doc) return;
    const id = s.doc.meta.id;
    const geoms = s.geomVersion !== savedGeomVersion ? s.geoms : null;
    const newFlags = Object.keys(s.flags).filter((k) => !savedFlags.has(k));
    savedGeomVersion = s.geomVersion;
    newFlags.forEach((k) => savedFlags.add(k));
    saving = saving
      .then(async () => {
        await saveDoc(s.doc!);
        if (geoms) await saveGeoms(id, geoms);
        for (const k of newFlags) await saveFlag(id, k, s.flags[k]);
      })
      .catch((e) => console.error('autosave failed', e))
      .finally(() => emitSave(false));
  }, 700);
  flushNow = () => {
    flush.flush();
    return saving;
  };

  const unsub = useWorld.subscribe((s, p) => {
    if (!s.doc) return;
    if (s.doc.meta.id !== worldId) {
      // A different world was opened: it was saved as a whole when loaded.
      worldId = s.doc.meta.id;
      savedGeomVersion = s.geomVersion;
      savedFlags = new Set(Object.keys(s.flags));
      return;
    }
    if (s.doc !== p.doc || s.geomVersion !== p.geomVersion || s.flags !== p.flags) {
      emitSave(true);
      flush();
    }
  });

  const onHide = () => flush.flush();
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && onHide());
  return () => {
    unsub();
    window.removeEventListener('pagehide', onHide);
  };
}
