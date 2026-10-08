import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorldBundle, WorldDoc, WorldMeta } from '../types';
import { listWorlds, deleteWorld, loadBundle, loadDoc, loadFlags, renameWorld, duplicateWorld, loadThumbs, saveThumb, mainWorld, storageUsage } from '../io/db';
import { readWorldFile, downloadMap } from '../io/files';
import { loadEarth } from '../io/earth';
import { fantasyEarth } from '../world/generate';
import { randomFlag } from '../world/flagGen';
import { seeded } from '../world/names';
import { iso2 } from '../world/flags';
import { Icon, type IconName } from './icons';
import { isNative } from '../native';
import { fmtAgo, fmtBytes, fmtCompact, fmtInt } from '../util';

type Sort = 'recent' | 'name' | 'size';

export function Home({ onOpen, busy }: { onOpen: (b: WorldBundle, isNew: boolean) => void; busy: string | null }) {
  const [worlds, setWorlds] = useState<WorldMeta[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [mainId, setMainId] = useState(mainWorld.get());
  const [drag, setDrag] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [newMenu, setNewMenu] = useState(false);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const list = await listWorlds().catch(() => [] as WorldMeta[]);
    setWorlds(list);
    const blobs = await loadThumbs().catch(() => ({}) as Record<string, Blob>);
    setThumbs((prev) => {
      Object.values(prev).forEach((u) => URL.revokeObjectURL(u));
      return Object.fromEntries(Object.entries(blobs).map(([id, b]) => [id, URL.createObjectURL(b)]));
    });
    storageUsage().then(setUsage);
    // Worlds saved before thumbnails existed get one now, one at a time.
    const missing = list.filter((w) => !blobs[w.id]);
    for (const w of missing) {
      const b = await loadBundle(w.id).catch(() => null);
      if (!b) continue;
      await saveThumb(b);
    }
    if (missing.length) {
      const again = await loadThumbs().catch(() => ({}) as Record<string, Blob>);
      setThumbs((prev) => {
        Object.values(prev).forEach((u) => URL.revokeObjectURL(u));
        return Object.fromEntries(Object.entries(again).map(([id, b]) => [id, URL.createObjectURL(b)]));
      });
    }
  };
  useEffect(() => {
    refresh();
    return () => setThumbs((prev) => (Object.values(prev).forEach((u) => URL.revokeObjectURL(u)), {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (label: string, fn: () => Promise<WorldBundle>, isNew = true) => {
    setError(null);
    setNewMenu(false);
    setWorking(label);
    try {
      const b = await fn();
      onOpen(b, isNew);
    } catch (e) {
      console.error(e);
      setError((e as Error).message || 'Could not open this file');
    } finally {
      setWorking(null);
    }
  };

  const openWorld = (w: WorldMeta) =>
    run(
      `Opening ${w.title}…`,
      async () => {
        const b = await loadBundle(w.id);
        if (!b) throw new Error('This world could not be read');
        return b;
      },
      false,
    );

  const onFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (f) run(`Importing ${f.name}…`, () => readWorldFile(f));
  };

  const main = useMemo(() => worlds?.find((w) => w.id === mainId) ?? worlds?.[0] ?? null, [worlds, mainId]);
  const others = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const list = (worlds ?? []).filter((w) => w.id !== main?.id && (!ql || w.title.toLowerCase().includes(ql)));
    if (sort === 'name') list.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'size') list.sort((a, b) => (b.regions ?? 0) - (a.regions ?? 0));
    return list;
  }, [worlds, main, q, sort]);

  const actions: WorldActions = {
    open: openWorld,
    rename: async (w, t) => {
      await renameWorld(w.id, t);
      refresh();
    },
    duplicate: async (w) => {
      setWorking(`Copying ${w.title}…`);
      try {
        await duplicateWorld(w.id);
        await refresh();
      } finally {
        setWorking(null);
      }
    },
    exportMap: async (w) => {
      setWorking(`Exporting ${w.title}…`);
      try {
        const b = await loadBundle(w.id);
        if (b) await downloadMap(b);
      } catch (e) {
        setError('Export failed: ' + (e as Error).message);
      } finally {
        setWorking(null);
      }
    },
    remove: async (w) => {
      await deleteWorld(w.id);
      if (mainId === w.id) {
        mainWorld.set(null);
        setMainId(null);
      }
      refresh();
    },
    setMain: (w) => {
      mainWorld.set(w.id);
      setMainId(w.id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  };

  const status = busy ?? working;
  const empty = worlds !== null && worlds.length === 0;

  const newWorld = (kind: 'earth' | 'blank' | 'fantasy') => {
    if (kind === 'earth') run('Building Earth…', () => loadEarth());
    if (kind === 'blank') run('Building a blank Earth…', () => loadEarth({ unclaimed: true }));
    if (kind === 'fantasy')
      run('Inventing nations…', async () => {
        const earth = await loadEarth();
        const seed = (Math.random() * 2 ** 31) | 0;
        const b = fantasyEarth(earth, { nations: 70 + Math.floor(Math.random() * 90), seed });
        const rand = seeded(seed ^ 0x5f3759df);
        // Drawing happens synchronously in order (so the seed decides every flag); only the encoding runs in parallel.
        const countries = Object.values(b.doc.countries);
        const flags = await Promise.all(countries.map((c) => randomFlag(c.color, rand)));
        countries.forEach((c, i) => {
          const flag = flags[i];
          if (flag) {
            b.flags[c.cid] = flag;
            c.flag = c.cid;
          }
        });
        return b;
      });
  };

  return (
    <div
      className={'home' + (drag ? ' dragging' : '')}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        onFiles(e.dataTransfer.files);
      }}
      onClick={() => newMenu && setNewMenu(false)}
    >
      <div className="home-bg" />
      <div className="home-inner">
        <header className="home-top">
          <div className="logo">
            <span className="logo-mark">
              <Icon name="globe" size={22} />
            </span>
            <span>Earth Vision</span>
          </div>
          <div className="grow" />
          <button className="btn" onClick={() => fileRef.current?.click()} title="Open an A+ World Map Editor .map file (or drop it anywhere)">
            <Icon name="upload" size={15} /> Open .map
          </button>
          <div className="menu-wrap">
            <button
              className="btn primary"
              onClick={(e) => {
                e.stopPropagation();
                setNewMenu(!newMenu);
              }}
            >
              <Icon name="plus" size={15} /> New world
            </button>
            {newMenu && (
              <div className="menu glass new-menu" onClick={(e) => e.stopPropagation()}>
                <NewOption icon="globe" title="Real Earth" sub="Today's countries over ~4,600 regions" onClick={() => newWorld('earth')} />
                <NewOption icon="sparkle" title="Fantasy Earth" sub="Invented nations, names & capitals" onClick={() => newWorld('fantasy')} />
                <NewOption icon="brush" title="Blank Earth" sub="All land unclaimed — paint from scratch" onClick={() => newWorld('blank')} />
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept={isNative ? undefined : '.map,.cmaps,application/zip,*/*'} hidden onChange={(e) => onFiles(e.target.files)} />
        </header>

        {error && (
          <div className="error-box">
            {error}
            <button className="icon-btn" onClick={() => setError(null)} title="Dismiss">
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        {worlds === null ? (
          <div className="hero hero-skeleton" />
        ) : empty ? (
          <Welcome onImport={() => fileRef.current?.click()} onNew={newWorld} />
        ) : (
          main && <Hero w={main} thumb={thumbs[main.id]} pinned={main.id === mainId} actions={actions} />
        )}

        {others.length > 0 || q ? (
          <section className="worlds">
            <div className="worlds-head">
              <h2>
                Other worlds <span className="count">{(worlds?.length ?? 1) - 1}</span>
              </h2>
              <div className="grow" />
              <div className="search-mini">
                <Icon name="search" size={14} />
                <input placeholder="Find a world" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="recent">Recent</option>
                <option value="name">Name</option>
                <option value="size">Size</option>
              </select>
            </div>
            <div className="world-grid">
              {others.map((w) => (
                <WorldCard key={w.id} w={w} thumb={thumbs[w.id]} actions={actions} />
              ))}
              {!others.length && <p className="hint">No world matches “{q}”.</p>}
            </div>
          </section>
        ) : null}

        <footer className="home-foot">
          <span>
            <Icon name="check" size={13} /> Works offline · saved in this browser{usage ? ` · ${fmtBytes(usage.used)} used` : ''}
          </span>
          <span>
            Relief, borders & places from{' '}
            <a href="https://www.naturalearthdata.com" target="_blank" rel="noreferrer">
              Natural Earth
            </a>{' '}
            · elevation from Mapzen Terrain Tiles
          </span>
        </footer>
      </div>
      {drag && (
        <div className="drop-hint">
          <Icon name="upload" size={34} />
          Drop your .map file to open it
        </div>
      )}
      {status && (
        <div className="busy">
          <div className="spinner" />
          {status}
        </div>
      )}
    </div>
  );
}

interface WorldActions {
  open: (w: WorldMeta) => void;
  rename: (w: WorldMeta, title: string) => void;
  duplicate: (w: WorldMeta) => void;
  exportMap: (w: WorldMeta) => void;
  remove: (w: WorldMeta) => void;
  setMain: (w: WorldMeta) => void;
}

function NewOption({ icon, title, sub, onClick }: { icon: IconName; title: string; sub: string; onClick: () => void }) {
  return (
    <button className="new-option" onClick={onClick}>
      <span className="new-icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="grow">
        <strong>{title}</strong>
        <small>{sub}</small>
      </span>
    </button>
  );
}

function Welcome({ onImport, onNew }: { onImport: () => void; onNew: (k: 'earth' | 'blank' | 'fantasy') => void }) {
  return (
    <section className="welcome">
      <h1>Shape your own world.</h1>
      <p>Draw countries out of thousands of regions, hand land from one nation to another, give them flags, capitals and stories.</p>
      <div className="welcome-actions">
        <button className="chip-btn accent" onClick={onImport}>
          <Icon name="upload" size={16} /> Open a .map
        </button>
        <button className="chip-btn" onClick={() => onNew('earth')}>
          <Icon name="globe" size={16} /> Real Earth
        </button>
        <button className="chip-btn" onClick={() => onNew('fantasy')}>
          <Icon name="sparkle" size={16} /> Fantasy Earth
        </button>
        <button className="chip-btn" onClick={() => onNew('blank')}>
          <Icon name="brush" size={16} /> Blank Earth
        </button>
      </div>
      <small className="hint">…or drop an A+ World Map Editor file anywhere on this page.</small>
    </section>
  );
}

// ── Main world ───────────────────────────────────────────────────────────────

interface Facts {
  pop: number;
  land: number;
  claimed: number;
  capitals: number;
  top: { cid: string; name: string; color: string; flag?: string; area: number; pop: number }[];
  popKey?: string;
}

function factsOf(doc: WorldDoc): Facts {
  const popKey = doc.settings.stats.find((s) => s.scale)?.key;
  const agg: Record<string, { area: number; pop: number }> = {};
  let land = 0;
  let claimed = 0;
  let pop = 0;
  for (const r of Object.values(doc.regions)) {
    land += r.area;
    const p = popKey ? r.vals?.[popKey] ?? 0 : 0;
    pop += p;
    if (!r.cid) continue;
    claimed += r.area;
    const a = (agg[r.cid] ??= { area: 0, pop: 0 });
    a.area += r.area;
    a.pop += p;
  }
  const top = Object.entries(agg)
    .filter(([cid]) => doc.countries[cid])
    .sort((a, b) => b[1].area - a[1].area)
    .slice(0, 5)
    .map(([cid, a]) => ({ cid, name: doc.countries[cid].name, color: doc.countries[cid].color, flag: doc.countries[cid].flag, ...a }));
  const capitals = Object.values(doc.countries).filter((c) => c.capital != null).length;
  return { pop, land, claimed, capitals, top, popKey };
}

function Hero({ w, thumb, pinned, actions }: { w: WorldMeta; thumb?: string; pinned: boolean; actions: WorldActions }) {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [flagUrls, setFlagUrls] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    let live = true;
    let urls: Record<string, string> = {};
    setFacts(null);
    loadDoc(w.id).then(async (d) => {
      if (!live || !d) return;
      const f = factsOf(d);
      setFacts(f);
      const blobs = await loadFlags(w.id, f.top.flatMap((c) => (c.flag ? [c.flag] : [])));
      if (!live) return;
      urls = Object.fromEntries(Object.entries(blobs).map(([k, b]) => [k, URL.createObjectURL(b)]));
      setFlagUrls(urls);
    });
    return () => {
      live = false;
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    };
  }, [w.id, w.modified]);

  return (
    <section className="hero">
      <button className="hero-map" onClick={() => actions.open(w)} title="Continue editing">
        {thumb ? <img onLoad={(e) => e.currentTarget.classList.add('loaded')} src={thumb} alt="" draggable={false} /> : <div className="thumb-empty"><Icon name="globe" size={40} /></div>}
        <span className="hero-play">
          <Icon name="play" size={20} /> Continue
        </span>
      </button>
      <div className="hero-info">
        <div className="hero-kicker">
          <Icon name="star" size={13} /> {pinned ? 'Main map' : 'Last edited'}
          <span className="dot">·</span> edited {fmtAgo(w.modified)}
        </div>
        {editing ? (
          <TitleInput
            value={w.title}
            className="hero-title-input"
            onDone={(t) => {
              setEditing(false);
              if (t && t !== w.title) actions.rename(w, t);
            }}
          />
        ) : (
          <h1 className="hero-title" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
            {w.title}
          </h1>
        )}
        <div className="pills">
          <Pill label="countries" value={fmtInt(w.countries ?? 0)} />
          <Pill label="regions" value={fmtInt(w.regions ?? 0)} />
          {facts && facts.pop > 0 && <Pill label={facts.popKey?.toLowerCase() ?? 'people'} value={fmtCompact(facts.pop)} />}
          {facts && facts.land > 0 && <Pill label="claimed" value={`${Math.round((facts.claimed / facts.land) * 100)}%`} />}
        </div>
        {facts && facts.top.length > 0 && (
          <div className="leaders">
            <small>Largest nations</small>
            {facts.top.map((c, i) => (
              <div key={c.cid} className="leader">
                <span className="rank">{i + 1}</span>
                <MiniFlag cid={c.cid} color={c.color} url={c.flag ? flagUrls[c.flag] : undefined} />
                <span className="grow name">{c.name}</span>
                <span className="bar" style={{ width: `${Math.max(6, (c.area / facts.top[0].area) * 70)}px`, background: c.color }} />
                <small>{fmtCompact(c.area)} km²</small>
              </div>
            ))}
          </div>
        )}
        <div className="hero-actions">
          <button className="btn primary" onClick={() => actions.open(w)}>
            <Icon name="play" size={15} /> Continue
          </button>
          <button className="btn" onClick={() => actions.exportMap(w)} title="Download as an A+ compatible .map">
            <Icon name="download" size={15} /> Export .map
          </button>
          <CardMenu w={w} actions={actions} onRename={() => setEditing(true)} isMain />
        </div>
      </div>
    </section>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span className="pill">
      <strong>{value}</strong> {label}
    </span>
  );
}

function MiniFlag({ cid, color, url }: { cid: string; color: string; url?: string }) {
  const code = iso2[cid];
  const src = url ?? (code ? new URL(`flags/${code}.png`, document.baseURI).href : null);
  if (src) return <img className="flag" src={src} alt="" style={{ width: 21, height: 14 }} />;
  return <span className="flag flag-none" style={{ width: 21, height: 14, background: color }} />;
}

// ── Other worlds ─────────────────────────────────────────────────────────────

function WorldCard({ w, thumb, actions }: { w: WorldMeta; thumb?: string; actions: WorldActions }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="world-card">
      <button className="world-thumb" onClick={() => actions.open(w)} title={`Open ${w.title}`}>
        {thumb ? <img onLoad={(e) => e.currentTarget.classList.add('loaded')} src={thumb} alt="" loading="lazy" draggable={false} /> : <div className="thumb-empty"><Icon name="globe" size={26} /></div>}
      </button>
      <div className="world-card-body">
        {editing ? (
          <TitleInput
            value={w.title}
            onDone={(t) => {
              setEditing(false);
              if (t && t !== w.title) actions.rename(w, t);
            }}
          />
        ) : (
          <strong onDoubleClick={() => setEditing(true)} title={w.title}>
            {w.title}
          </strong>
        )}
        <small>
          {fmtInt(w.countries ?? 0)} countries · {fmtAgo(w.modified)}
        </small>
      </div>
      <CardMenu w={w} actions={actions} onRename={() => setEditing(true)} />
    </div>
  );
}

function CardMenu({ w, actions, onRename, isMain }: { w: WorldMeta; actions: WorldActions; onRename: () => void; isMain?: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setConfirm(false);
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);
  const item = (icon: IconName, label: string, fn: () => void) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setOpen(false);
        fn();
      }}
    >
      <Icon name={icon} size={15} /> {label}
    </button>
  );
  return (
    <div className="menu-wrap card-menu">
      <button
        className="icon-btn"
        title="More"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
          setConfirm(false);
        }}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu glass" onClick={(e) => e.stopPropagation()}>
          {!isMain && item('star', 'Make main map', () => actions.setMain(w))}
          {item('edit', 'Rename', onRename)}
          {item('copy', 'Duplicate', () => actions.duplicate(w))}
          {!isMain && item('download', 'Export .map', () => actions.exportMap(w))}
          {confirm ? (
            <div className="confirm-row">
              <span>Delete for good?</span>
              <button
                className="btn danger small"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  actions.remove(w);
                }}
              >
                Delete
              </button>
            </div>
          ) : (
            <button
              className="danger"
              onClick={(e) => {
                e.stopPropagation();
                setConfirm(true);
              }}
            >
              <Icon name="trash" size={15} /> Delete…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TitleInput({ value, onDone, className }: { value: string; onDone: (v: string) => void; className?: string }) {
  const [v, setV] = useState(value);
  return (
    <input
      className={'title-input ' + (className ?? '')}
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => onDone(v.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') onDone(value);
      }}
    />
  );
}
