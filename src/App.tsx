import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { WorldBundle } from './types';
import { useWorld, loadWorld, closeWorld, toast, currentBundle, select, setTool } from './world/store';
import { onBackButton } from './native';
import { loadBundle, saveBundle, saveThumb, lastWorld } from './io/db';
import { readWorldFile } from './io/files';
import { flushAutosave } from './world/persist';
import { Home } from './ui/Home';

// The editor pulls in MapLibre (most of the app's code): load it only when a world opens.
const Editor = lazy(() => import('./ui/Editor').then((m) => ({ default: m.Editor })));
// Start fetching it right away anyway, so opening a world rarely waits on the network.
const preloadEditor = () => void import('./ui/Editor');
import { Icon } from './ui/icons';

export default function App() {
  const [view, setView] = useState<'boot' | 'home' | 'editor'>('boot');
  const [busy, setBusy] = useState<string | null>(null);
  const hasDoc = useWorld((s) => !!s.doc);
  useEffect(preloadEditor, []);

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

  const goHome = async () => {
    setBusy('Saving…');
    try {
      await flushAutosave();
      await saveThumb(currentBundle());
    } finally {
      setBusy(null);
    }
    lastWorld.set(null);
    closeWorld();
    setView('home');
  };

  // Android back: close what is open, step by step, then leave the world; on the home screen the app goes to the background.
  const back = useRef<() => boolean>(() => false);
  back.current = () => {
    if (busy) return true;
    if (view !== 'editor') return false;
    const s = useWorld.getState();
    if (s.flagMakerFor) useWorld.setState({ flagMakerFor: null });
    else if (s.flagView) useWorld.setState({ flagView: null });
    else if (s.detailsOpen) useWorld.setState({ detailsOpen: false });
    else if (s.worldOpen) useWorld.setState({ worldOpen: false });
    else if (s.help) useWorld.setState({ help: false });
    else if (s.advancedOpen) useWorld.setState({ advancedOpen: false });
    else if (s.galleryOpen) useWorld.setState({ galleryOpen: false });
    else if (s.layersOpen) useWorld.setState({ layersOpen: false });
    else if (s.tool !== 'select') setTool('select');
    else if (s.selection.cid || s.selection.regions.length || s.selection.city != null) select({});
    else void goHome();
    return true;
  };
  useEffect(() => onBackButton(() => back.current()), []);

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
          <div className="boot-globe" />
          <span>Earth Vision</span>
        </div>
      )}
      {view === 'home' && <Home onOpen={open} busy={busy} />}
      {view === 'editor' && busy && (
        <div className="busy">
          <div className="spinner" />
          {busy}
        </div>
      )}
      {view === 'editor' && hasDoc && (
        <Boundary>
        <Suspense
          fallback={
            <div className="boot">
              <div className="boot-globe" />
              <span>Earth Vision</span>
            </div>
          }
        >
        <Editor
          onHome={goHome}
        />
        </Suspense>
        </Boundary>
      )}
      <Toast />
    </>
  );
}

function Toast() {
  const t = useWorld((s) => s.toast);
  if (!t) return null;
  return (
    <div key={t.id} className={'toast ' + (t.kind ?? '')} role="status">
      {t.kind && <Icon name={t.kind === 'ok' ? 'check' : 'info'} size={15} />}
      <span>{t.text}</span>
    </div>
  );
}

/** A crash in one screen shows a way out instead of a blank app; the world itself is already saved. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boot crash">
        <strong>Something went wrong.</strong>
        <span>Your world is saved. {this.state.error.message}</span>
        <button className="btn primary" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
