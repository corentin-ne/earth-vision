import { useEffect, useRef, useState } from 'react';
import type { WorldBundle, WorldMeta } from '../types';
import { listWorlds, deleteWorld, loadBundle, renameWorld } from '../io/db';
import { importAmap, isAmap } from '../io/amap';
import { importProject, exportProject } from '../io/project';
import { loadEarth } from '../io/earth';
import { Icon } from './icons';
import { download, fmtInt } from '../util';

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

const SOURCE: Record<WorldMeta['source'], string> = { amap: 'A+ map', earth: 'Earth', blank: 'Blank Earth', cmaps: 'Project' };

export function Home({ onOpen, busy }: { onOpen: (b: WorldBundle, isNew: boolean) => void; busy: string | null }) {
  const [worlds, setWorlds] = useState<WorldMeta[] | null>(null);
  const [drag, setDrag] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => listWorlds().then(setWorlds).catch(() => setWorlds([]));
  useEffect(() => {
    refresh();
  }, []);

  const run = async (label: string, fn: () => Promise<WorldBundle>) => {
    setError(null);
    setWorking(label);
    try {
      const b = await fn();
      onOpen(b, true);
    } catch (e) {
      console.error(e);
      setError((e as Error).message || 'Could not open this file');
    } finally {
      setWorking(null);
    }
  };

  const onFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (f) run(`Importing ${f.name}…`, () => readWorldFile(f));
  };

  const status = busy ?? working;
  return (
    <div
      className={'home' + (drag ? ' dragging' : '')}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        onFiles(e.dataTransfer.files);
      }}
    >
      <div className="home-bg" />
      <div className="home-inner">
        <header className="home-head">
          <div className="logo">
            <Icon name="globe" size={30} />
            <span>Earth Vision</span>
          </div>
          <p>Shape your own world: draw countries out of thousands of regions, move them from one nation to another, give them flags, capitals and stories. Works offline.</p>
        </header>

        <div className="start-grid">
          <button className="start-card import" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={26} />
            <strong>Open a map file</strong>
            <span>A+ World Map Editor <code>.map</code> or CMaps <code>.cmaps</code> — or drop it anywhere</span>
          </button>
          <button className="start-card earth" onClick={() => run('Building Earth…', () => loadEarth())}>
            <Icon name="globe" size={26} />
            <strong>Real Earth</strong>
            <span>Today's countries, split into ~4,600 regions</span>
          </button>
          <button className="start-card blank" onClick={() => run('Building a blank Earth…', () => loadEarth({ unclaimed: true }))}>
            <Icon name="brush" size={26} />
            <strong>Blank Earth</strong>
            <span>All land unclaimed — paint your nations from scratch</span>
          </button>
          <input ref={fileRef} type="file" accept=".map,.cmaps,application/zip,*/*" hidden onChange={(e) => onFiles(e.target.files)} />
        </div>

        {error && <div className="error-box">{error}</div>}

        <section className="worlds">
          <h2>Your worlds</h2>
          {worlds === null ? (
            <p className="hint">Loading…</p>
          ) : worlds.length === 0 ? (
            <p className="hint">Nothing yet. Open your .map file or start from Earth — everything is saved in this browser automatically.</p>
          ) : (
            <div className="world-list">
              {worlds.map((w) => (
                <div key={w.id} className="world-row">
                  <button
                    className="world-open"
                    onClick={() =>
                      run(`Opening ${w.title}…`, async () => {
                        const b = await loadBundle(w.id);
                        if (!b) throw new Error('This world could not be read');
                        return b;
                      }).then(() => undefined)
                    }
                  >
                    <span className="world-icon">
                      <Icon name="globe" size={20} />
                    </span>
                    <span className="grow">
                      <strong>{w.title}</strong>
                      <small>
                        {SOURCE[w.source]} · {fmtInt(w.countries ?? 0)} countries · {fmtInt(w.regions ?? 0)} regions · edited {new Date(w.modified).toLocaleString()}
                      </small>
                    </span>
                  </button>
                  <button
                    className="icon-btn"
                    title="Rename"
                    onClick={async () => {
                      const t = prompt('Rename world', w.title);
                      if (t?.trim()) {
                        await renameWorld(w.id, t.trim());
                        refresh();
                      }
                    }}
                  >
                    <Icon name="edit" size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    title="Download a backup (.cmaps)"
                    onClick={async () => {
                      const b = await loadBundle(w.id);
                      if (b) download(await exportProject(b), `${w.title}.cmaps`);
                    }}
                  >
                    <Icon name="download" size={16} />
                  </button>
                  <button
                    className="icon-btn danger"
                    title="Delete from this browser"
                    onClick={async () => {
                      if (!confirm(`Delete "${w.title}" from this browser? Download a backup first if you want to keep it.`)) return;
                      await deleteWorld(w.id);
                      refresh();
                    }}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
        <footer className="home-foot">
          Relief, borders & places from <a href="https://www.naturalearthdata.com" target="_blank" rel="noreferrer">Natural Earth</a> · elevation from Mapzen Terrain Tiles (AWS Open Data)
        </footer>
      </div>
      {status && (
        <div className="busy">
          <div className="spinner" />
          {status}
        </div>
      )}
    </div>
  );
}
