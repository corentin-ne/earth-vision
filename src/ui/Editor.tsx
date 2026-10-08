import { useEffect, useMemo, useRef, useState } from 'react';
import { MapController, setMapCtl, mapCtl } from '../map/controller';
import {
  useWorld,
  countryAggregates,
  undo,
  redo,
  select,
  setTool,
  setTitle,
  currentBundle,
  countryBounds,
  toast,
  type Tool,
  type MapStyleId,
  type Layers,
} from '../world/store';
import { CountryPanel } from './CountryPanel';
import { CityPanel, MultiRegionPanel, RegionCard } from './RegionPanels';
import { WorldPanel } from './WorldPanel';
import { AdvancedPanel } from './AdvancedPanel';
import { FlagGallery, FlagLightbox } from './FlagViewer';
import { CountryPicker, Flag, TextField } from './common';
import { Icon, type IconName } from './icons';
import { downloadMap, fileBase } from '../io/files';
import { flushAutosave, onSaveState } from '../world/persist';
import { download } from '../util';

export function Editor({ onHome }: { onHome: () => void }) {
  useShortcuts();
  return (
    <div className="editor">
      <MapView />
      <TopBar onHome={onHome} />
      <ToolDock />
      <Inspector />
      <LayersPanel />
      <HoverTip />
      <SplitHint />
      <ShortcutsHelp />
      <AdvancedPanel />
      <FlagGallery />
      <FlagLightbox />
    </div>
  );
}

function MapView() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ctl = new MapController(ref.current!);
    setMapCtl(ctl);
    ctl.onHover = (h) => hoverBus.emit(h);
    ctl.onDrawChange = (n) => drawBus.emit(n);
    (window as unknown as { cmaps: unknown }).cmaps = { ctl, store: useWorld };
    return () => {
      setMapCtl(null);
      ctl.destroy();
    };
  }, []);
  return <div ref={ref} className="map" />;
}

// Tiny pub/subs so high-frequency map events don't go through React state of the whole tree.
function bus<T>() {
  const subs = new Set<(v: T) => void>();
  return { emit: (v: T) => subs.forEach((s) => s(v)), on: (s: (v: T) => void) => (subs.add(s), () => void subs.delete(s)) };
}
const hoverBus = bus<{ x: number; y: number; region: number | null; city: number | null } | null>();
const drawBus = bus<number>();

function HoverTip() {
  const [h, setH] = useState<{ x: number; y: number; region: number | null; city: number | null } | null>(null);
  const doc = useWorld((s) => s.doc);
  const tool = useWorld((s) => s.tool);
  useEffect(() => hoverBus.on(setH), []);
  if (!h || !doc || (h.region == null && h.city == null) || tool === 'split') return null;
  const r = h.region != null ? doc.regions[h.region] : null;
  const c = r ? doc.countries[r.cid] : undefined;
  const city = h.city != null ? doc.cities[h.city] : null;
  return (
    <div className="hover-tip" style={{ transform: `translate(${h.x + 16}px, ${h.y + 14}px)` }}>
      {city ? (
        <strong>
          {city.capital && <Icon name="crown" size={12} />} {city.name}
        </strong>
      ) : (
        r && (
          <>
            <Flag country={c} size={13} />
            <span>
              <strong>{c?.name ?? 'Unclaimed'}</strong>
              <small>{r.name}</small>
            </span>
          </>
        )
      )}
    </div>
  );
}

function SplitHint() {
  const tool = useWorld((s) => s.tool);
  const sel = useWorld((s) => s.selection.regions.length);
  const [n, setN] = useState(0);
  useEffect(() => drawBus.on(setN), []);
  if (tool !== 'split') return null;
  return (
    <div className="split-hint">
      <Icon name="knife" size={16} />
      <span>
        {n === 0
          ? `Click to draw a line across ${sel ? 'the selected region' + (sel > 1 ? 's' : '') : 'the region(s) to cut'}.`
          : 'Keep clicking · double-click or Enter to cut · Backspace removes a point · Esc cancels'}
      </span>
      {n > 1 && (
        <button className="btn primary small" onClick={() => mapCtl?.finishSplit()}>
          Cut
        </button>
      )}
    </div>
  );
}

// ── Top bar ──────────────────────────────────────────────────────────────────

function TopBar({ onHome }: { onHome: () => void }) {
  const title = useWorld((s) => s.doc?.meta.title ?? '');
  const canUndo = useWorld((s) => s.past.length > 0);
  const canRedo = useWorld((s) => s.future.length > 0);
  const undoLabel = useWorld((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useWorld((s) => s.future[s.future.length - 1]?.label);
  const [menu, setMenu] = useState(false);
  const exportAs = (kind: ExportKind) => {
    setMenu(false);
    exportWorld(kind);
  };

  return (
    <header className="topbar glass">
      <button className="icon-btn" onClick={onHome} title="All worlds">
        <Icon name="home" />
      </button>
      <TextField className="world-title" value={title} onCommit={(t) => t.trim() && setTitle(t.trim())} />
      <SaveBadge />
      <div className="sep" />
      <button className="icon-btn" disabled={!canUndo} onClick={undo} title={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Undo'}>
        <Icon name="undo" />
      </button>
      <button className="icon-btn" disabled={!canRedo} onClick={redo} title={redoLabel ? `Redo: ${redoLabel} (Ctrl+Y)` : 'Redo'}>
        <Icon name="redo" />
      </button>
      <div className="sep" />
      <Search />
      <button className="icon-btn hide-phone" onClick={surprise} title="Surprise me: visit a random country (R)">
        <Icon name="dice" />
      </button>
      <button className="icon-btn" onClick={() => useWorld.setState({ advancedOpen: true })} title="Advanced: population, heal borders, colours… (A)">
        <Icon name="tune" />
      </button>
      <div className="menu-wrap">
        <button className="icon-btn" onClick={() => setMenu(!menu)} title="Export">
          <Icon name="download" />
        </button>
        {menu && (
          <div className="menu glass" onMouseLeave={() => setMenu(false)}>
            <button onClick={() => exportAs('map')}>
              <Icon name="file" size={15} /> <span className="grow">World map (.map)</span>
              <kbd>Ctrl E</kbd>
            </button>
            <button onClick={() => exportAs('png')}>
              <Icon name="camera" size={15} /> <span className="grow">Image of this view (.png)</span>
              <kbd>P</kbd>
            </button>
            <button onClick={() => exportAs('geojson')}>
              <Icon name="globe" size={15} /> <span className="grow">Regions (.geojson)</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

type ExportKind = 'map' | 'png' | 'geojson';

async function exportWorld(kind: ExportKind) {
  const b = currentBundle();
  const base = fileBase(b.doc.meta.title);
  try {
    if (kind === 'map') await downloadMap(b);
    if (kind === 'png') {
      const blob = await mapCtl?.snapshot();
      if (blob) await download(blob, `${base}.png`, 'image/png');
    }
    if (kind === 'geojson') {
      const features = Object.values(b.doc.regions)
        .filter((r) => b.geoms[r.id])
        .map((r) => ({
          type: 'Feature',
          id: r.id,
          geometry: b.geoms[r.id],
          properties: { name: r.name, country: r.cid, country_name: b.doc.countries[r.cid]?.name ?? null, area_km2: Math.round(r.area), ...r.vals },
        }));
      await download(JSON.stringify({ type: 'FeatureCollection', features }), `${base}-regions.geojson`, 'application/geo+json');
    }
    toast(kind === 'png' ? 'Snapshot saved' : 'Exported', 'ok');
  } catch (e) {
    console.error(e);
    toast('Export failed: ' + (e as Error).message, 'error');
  }
}

/** Flies to a random country and opens its page. */
function surprise() {
  const doc = useWorld.getState().doc;
  if (!doc) return;
  const agg = countryAggregates(doc);
  const owned = Object.values(doc.countries).filter((c) => agg[c.cid]?.regions);
  if (!owned.length) return toast('No country to visit yet — paint one first!');
  const cur = useWorld.getState().selection.cid;
  const pool = owned.length > 1 ? owned.filter((c) => c.cid !== cur) : owned;
  const c = pool[Math.floor(Math.random() * pool.length)];
  select({ cid: c.cid });
  mapCtl?.fitBounds(countryBounds(c.cid));
}

/** "Saving…" / "Saved" next to the title. */
function SaveBadge() {
  const [pending, setPending] = useState(false);
  useEffect(() => onSaveState(setPending), []);
  return (
    <span className={'save-badge' + (pending ? ' pending' : '')} title={pending ? 'Saving…' : 'All changes saved in this browser'}>
      {pending ? <span className="save-dot" /> : <Icon name="check" size={13} />}
      <span className="hide-phone">{pending ? 'Saving' : 'Saved'}</span>
    </span>
  );
}

const SHORTCUTS: [string, string][] = [
  ['V', 'Select'],
  ['B', 'Paint regions'],
  ['K', 'Split regions'],
  ['C', 'Cities'],
  ['[  ]', 'Smaller / bigger brush'],
  ['Alt + click', 'Pick a country (paint)'],
  ['Ctrl + click', 'Take a whole country (paint)'],
  ['Space', 'Pan while painting'],
  ['Shift + click', 'Select several regions'],
  ['G', 'Globe / flat map'],
  ['L', 'Map style & layers'],
  ['R', 'Surprise me: random country'],
  ['P', 'Save a picture of the view'],
  ['A', 'Advanced tools'],
  ['F', 'Flags of the world'],
  ['Ctrl + K', 'Search'],
  ['Ctrl + Z / Y', 'Undo / redo'],
  ['Ctrl + S', 'Save now'],
  ['Ctrl + E', 'Export .map'],
  ['Esc', 'Back / cancel'],
  ['?', 'This help'],
];

function ShortcutsHelp() {
  const open = useWorld((s) => s.help);
  if (!open) return null;
  const close = () => useWorld.setState({ help: false });
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal glass" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="keyboard" />
          <h2 className="grow">Keyboard shortcuts</h2>
          <button className="icon-btn" onClick={close} title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <div className="shortcut-grid">
          {SHORTCUTS.map(([k, label]) => (
            <div key={k} className="shortcut">
              <span>{label}</span>
              <span className="keys">
                {k.split(' + ').map((p, i) => (
                  <kbd key={i}>{p}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Search() {
  const doc = useWorld((s) => s.doc);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const results = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!doc || ql.length < 2) return [];
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const qn = norm(ql);
    const out: { kind: 'country' | 'region' | 'city'; id: string | number; name: string; sub: string }[] = [];
    for (const c of Object.values(doc.countries)) if (norm(c.name).includes(qn) || c.cid.toLowerCase() === ql) out.push({ kind: 'country', id: c.cid, name: c.name, sub: 'Country' });
    for (const c of Object.values(doc.cities)) if (norm(c.name).includes(qn)) out.push({ kind: 'city', id: c.id, name: c.name, sub: c.capital ? 'Capital' : 'City' });
    for (const r of Object.values(doc.regions))
      if (norm(r.name).includes(qn)) out.push({ kind: 'region', id: r.id, name: r.name, sub: doc.countries[r.cid]?.name ?? 'Unclaimed' });
    const starts = (n: string) => (norm(n).startsWith(qn) ? 0 : 1);
    const kindRank = { country: 0, city: 1, region: 2 };
    return out.sort((a, b) => starts(a.name) - starts(b.name) || kindRank[a.kind] - kindRank[b.kind]).slice(0, 12);
  }, [q, doc]);

  const go = (r: (typeof results)[number]) => {
    if (!doc) return;
    if (r.kind === 'country') {
      select({ cid: r.id as string });
      mapCtl?.fitBounds(countryBounds(r.id as string));
    } else if (r.kind === 'city') {
      const c = doc.cities[r.id as number];
      select({ city: c.id });
      mapCtl?.flyTo([c.lng, c.lat], 6.5);
    } else {
      const reg = doc.regions[r.id as number];
      select({ cid: reg.cid || null, regions: [reg.id] });
      mapCtl?.flyTo([reg.cx, reg.cy], 5.5);
    }
    setQ('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="search">
      <Icon name="search" size={16} />
      <input
        ref={inputRef}
        placeholder="Search countries, regions, cities…  (Ctrl+K)"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && results[0]) go(results[0]);
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
      />
      {open && results.length > 0 && (
        <div className="search-results glass">
          {results.map((r) => (
            <button key={`${r.kind}:${r.id}`} onMouseDown={(e) => e.preventDefault()} onClick={() => go(r)}>
              {r.kind === 'country' ? <Flag country={doc!.countries[r.id as string]} size={14} /> : <Icon name={r.kind === 'city' ? 'city' : 'flat'} size={14} />}
              <span className="grow">{r.name}</span>
              <small>{r.sub}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tools ────────────────────────────────────────────────────────────────────

const TOOLS: { id: Tool; icon: IconName; label: string; key: string }[] = [
  { id: 'select', icon: 'pointer', label: 'Select', key: 'V' },
  { id: 'paint', icon: 'brush', label: 'Paint regions', key: 'B' },
  { id: 'split', icon: 'knife', label: 'Split regions', key: 'K' },
  { id: 'city', icon: 'city', label: 'Cities', key: 'C' },
];

function ToolDock() {
  const tool = useWorld((s) => s.tool);
  const brushCid = useWorld((s) => s.brushCid);
  const brushSize = useWorld((s) => s.brushSize);
  const country = useWorld((s) => s.doc?.countries[brushCid]);
  const brushMode = useWorld((s) => s.brushMode);
  const multi = useWorld((s) => s.multiSelect);
  return (
    <div className="tooldock">
      <div className="tools glass">
        {TOOLS.map((t) => (
          <button key={t.id} className={'tool' + (tool === t.id ? ' on' : '')} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`}>
            <Icon name={t.icon} size={20} />
          </button>
        ))}
      </div>
      {tool === 'paint' && (
        <div className="brush glass">
          <div className="brush-row">
            <span className="brush-swatch" style={{ background: country?.color ?? 'transparent' }} />
            <CountryPicker value={brushCid} allowNone noneLabel="Unclaimed (erase)" onChange={(cid) => useWorld.setState({ brushCid: cid })} />
          </div>
          <div className="segmented">
            {(
              [
                ['paint', 'brush', 'Paint'],
                ['pick', 'pipette', 'Pick'],
                ['whole', 'flag', 'Whole country'],
              ] as const
            ).map(([m, icon, label]) => (
              <button key={m} className={brushMode === m ? 'on' : ''} onClick={() => useWorld.setState({ brushMode: m })}>
                <Icon name={icon} size={14} /> {label}
              </button>
            ))}
          </div>
          <label className="brush-size">
            <span>Brush</span>
            <input type="range" min={0} max={60} value={brushSize} onChange={(e) => useWorld.setState({ brushSize: +e.target.value })} />
            <small>{brushSize === 0 ? 'One region' : `${brushSize}px`}</small>
          </label>
          <p className="hint">
            Drag to paint · <kbd>Alt</kbd>+click picks a country · <kbd>Ctrl</kbd>+click takes a whole country · hold <kbd>Space</kbd> to pan
          </p>
        </div>
      )}
      {tool === 'select' && (
        <button
          className={'multi-toggle glass' + (multi ? ' on' : '')}
          onClick={() => useWorld.setState({ multiSelect: !multi })}
          title="Tap regions to add them to the selection (same as Shift+click)"
        >
          <Icon name="plus" size={14} /> Multi-select
        </button>
      )}
      {tool === 'city' && (
        <div className="brush glass">
          <p className="hint">Click the map to place a city · drag a city to move it · click one to edit it</p>
        </div>
      )}
    </div>
  );
}

// ── Inspector ────────────────────────────────────────────────────────────────

function Inspector() {
  const sel = useWorld((s) => s.selection);
  const doc = useWorld((s) => s.doc)!;
  const [collapsed, setCollapsed] = useState(false);
  let title = doc.meta.title;
  let body = <WorldPanel />;
  let back = false;
  if (sel.city != null && doc.cities[sel.city]) {
    title = 'City';
    body = <CityPanel id={sel.city} />;
    back = true;
  } else if (sel.regions.length > 1) {
    title = 'Selection';
    body = <MultiRegionPanel ids={sel.regions} />;
    back = true;
  } else if (sel.cid && doc.countries[sel.cid]) {
    title = 'Country';
    body = <CountryPanel cid={sel.cid} />;
    back = true;
  } else if (sel.regions.length === 1 && doc.regions[sel.regions[0]]) {
    title = 'Unclaimed region';
    body = (
      <div className="panel-body">
        <RegionCard region={doc.regions[sel.regions[0]]} />
      </div>
    );
    back = true;
  }
  return (
    <aside className={'inspector glass' + (collapsed ? ' collapsed' : '')}>
      <div className="inspector-head">
        {back ? (
          <button className="icon-btn" onClick={() => select({})} title="Back to world overview (Esc)">
            <Icon name="list" />
          </button>
        ) : (
          <Icon name="globe" />
        )}
        <h2 className="grow">{title}</h2>
        <button className="icon-btn collapse-btn" onClick={() => setCollapsed(!collapsed)} title={collapsed ? 'Expand' : 'Collapse'}>
          <Icon name={collapsed ? 'chevronDown' : 'x'} />
        </button>
      </div>
      {!collapsed && <div className="inspector-scroll">{body}</div>}
    </aside>
  );
}

// ── Layers ───────────────────────────────────────────────────────────────────

const STYLES: { id: MapStyleId; label: string; desc: string }[] = [
  { id: 'political', label: 'Political', desc: 'Country colours with relief shading' },
  { id: 'atlas', label: 'Atlas', desc: 'Physical relief with fine borders' },
  { id: 'plain', label: 'Plain', desc: 'Flat colours, like A+ World Map' },
  { id: 'night', label: 'Night', desc: 'Dark, for screenshots' },
];

const LAYER_LABELS: [keyof Layers, string][] = [
  ['countryLabels', 'Country names'],
  ['flags', 'Flags'],
  ['regionBorders', 'Region borders'],
  ['regionLabels', 'Region names'],
  ['cities', 'Cities'],
  ['water', 'Seas & lakes names'],
  ['relief', 'Terrain relief'],
  ['hillshade', 'Hill shading'],
  ['terrain', '3D mountains'],
  ['rivers', 'Rivers'],
  ['urban', 'Urban areas'],
  ['graticule', 'Graticule'],
];

function LayersPanel() {
  const open = useWorld((s) => s.layersOpen);
  const setOpen = (v: boolean) => useWorld.setState({ layersOpen: v });
  const mapStyle = useWorld((s) => s.mapStyle);
  const globe = useWorld((s) => s.globe);
  const layers = useWorld((s) => s.layers);
  return (
    <div className="layers">
      <div className="layers-buttons glass">
        <button className="icon-btn" onClick={() => useWorld.setState({ globe: !globe })} title={globe ? 'Flat map' : 'Globe'}>
          <Icon name={globe ? 'flat' : 'globe'} />
        </button>
        <button className={'icon-btn' + (open ? ' on' : '')} onClick={() => setOpen(!open)} title="Map style & layers (L)">
          <Icon name="layers" />
        </button>
        <button className="icon-btn hide-phone" onClick={() => useWorld.setState({ help: true })} title="Keyboard shortcuts (?)">
          <Icon name="keyboard" />
        </button>
      </div>
      {open && (
        <div className="layers-pop glass">
          <div className="style-grid">
            {STYLES.map((s) => (
              <button key={s.id} className={'style-chip ' + s.id + (mapStyle === s.id ? ' on' : '')} onClick={() => useWorld.setState({ mapStyle: s.id })} title={s.desc}>
                <span className="style-preview" />
                {s.label}
              </button>
            ))}
          </div>
          <div className="toggles">
            {LAYER_LABELS.map(([k, label]) => (
              <label key={k} className="toggle">
                <input type="checkbox" checked={layers[k]} onChange={(e) => useWorld.setState({ layers: { ...layers, [k]: e.target.checked } })} />
                <span className="switch" />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Global keyboard shortcuts for the editor. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 's') {
        e.preventDefault();
        if (useWorld.getState().doc) flushAutosave().then(() => toast('Saved', 'ok'));
      } else if ((e.ctrlKey || e.metaKey) && k === 'e') {
        e.preventDefault();
        if (useWorld.getState().doc) exportWorld('map');
      } else if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault();
        redo();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (k === 'v') setTool('select');
        else if (k === 'b') setTool('paint');
        else if (k === 'k') setTool('split');
        else if (k === 'c') setTool('city');
        else if (k === 'g') useWorld.setState((s) => ({ globe: !s.globe }));
        else if (k === 'l') useWorld.setState((s) => ({ layersOpen: !s.layersOpen }));
        else if (k === 'r' && useWorld.getState().doc) surprise();
        else if (k === 'a' && useWorld.getState().doc) useWorld.setState((s) => ({ advancedOpen: !s.advancedOpen }));
        else if (k === 'f' && useWorld.getState().doc) useWorld.setState((s) => ({ galleryOpen: !s.galleryOpen }));
        else if (k === 'p' && useWorld.getState().doc) exportWorld('png');
        else if (e.key === '?') useWorld.setState((s) => ({ help: !s.help }));
        else if (k === '[') useWorld.setState((s) => ({ brushSize: Math.max(0, s.brushSize - 5) }));
        else if (k === ']') useWorld.setState((s) => ({ brushSize: Math.min(60, s.brushSize + 5) }));
        else if (k === 'escape' && useWorld.getState().help) useWorld.setState({ help: false });
        else if (k === 'escape' && useWorld.getState().advancedOpen) useWorld.setState({ advancedOpen: false });
        else if (k === 'escape' && useWorld.getState().galleryOpen) useWorld.setState({ galleryOpen: false });
        else if (k === 'escape' && useWorld.getState().tool !== 'split') {
          if (useWorld.getState().tool !== 'select') setTool('select');
          else select({});
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
