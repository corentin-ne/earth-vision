import { useEffect, useState } from 'react';
import type { WorldBundle } from './types';
import { useWorld, loadWorld, closeWorld, toast } from './world/store';
import { loadBundle, saveBundle, lastWorld } from './io/db';
import { Editor, useShortcuts } from './ui/Editor';
import { Home, readWorldFile } from './ui/Home';

export default function App() {
  const [view, setView] = useState<'boot' | 'home' | 'editor'>('boot');
  const [busy, setBusy] = useState<string | null>(null);
  const hasDoc = useWorld((s) => !!s.doc);
  useShortcuts();

  const open = async (b: WorldBundle, isNew: boolean) => {
    setBusy('Opening…');
    try {
      if (isNew) await saveBundle(b);
      loadWorld(b);
      lastWorld.set(b.doc.meta.id);
      setView('editor');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const id = lastWorld.get();
    if (!id) {
      setView('home');
      return;
    }
    loadBundle(id)
      .then((b) => {
        if (b) {
          loadWorld(b);
          setView('editor');
        } else setView('home');
      })
      .catch(() => setView('home'));
  }, []);

  // Dropping a file on the editor opens it as a new world.
  useEffect(() => {
    if (view !== 'editor') return;
    const over = (e: DragEvent) => e.preventDefault();
    const drop = async (e: DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      try {
        await open(await readWorldFile(f), true);
        toast(`Opened ${f.name}`, 'ok');
      } catch (err) {
        toast('Could not open file: ' + (err as Error).message, 'error');
      }
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [view]);

  return (
    <>
      {view === 'boot' && (
        <div className="boot">
          <div className="spinner" />
        </div>
      )}
      {view === 'home' && <Home onOpen={open} busy={busy} />}
      {view === 'editor' && hasDoc && (
        <Editor
          onHome={() => {
            lastWorld.set(null);
            closeWorld();
            setView('home');
          }}
        />
      )}
      <Toast />
    </>
  );
}

function Toast() {
  const t = useWorld((s) => s.toast);
  if (!t) return null;
  return (
    <div key={t.id} className={'toast ' + (t.kind ?? '')}>
      {t.text}
    </div>
  );
}
