import { useEffect, useMemo, useRef, useState } from 'react';
import { MapController, setMapCtl, mapCtl } from '../map/controller';
import {
  useWorld,
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
import { CountryPicker, Flag, TextField } from './common';
import { Icon, type IconName } from './icons';
import { exportAmap } from '../io/amap';
import { exportProject } from '../io/project';
import { download } from '../util';

export function Editor({ onHome }: { onHome: () => void }) {
  return (
    <div className="editor">
      <MapView />
      <TopBar onHome={onHome} />
      <ToolDock />
      <Inspector />
      <LayersPanel />
      <HoverTip />
      <SplitHint />
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

  const exportAs = async (kind: 'map' | 'cmaps' | 'png' | 'geojson') => {
    setMenu(false);
    const b = currentBundle();
    const base = b.doc.meta.title.replace(/[^\w\- ]+/g, '').trim() || 'world';
    try {
      if (kind === 'map') download(await exportAmap(b), `${base}.map`);
      if (kind === 'cmaps') download(await exportProject(b), `${base}.cmaps`);
      if (kind === 'png') {
        const blob = await mapCtl?.snapshot();
        if (blob) download(blob, `${base}.png`, 'image/png');
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
        download(JSON.stringify({ type: 'FeatureCollection', features }), `${base}-regions.geojson`, 'application/geo+json');
      }
      toast('Exported', 'ok');
    } catch (e) {
      console.error(e);
      toast('Export failed: ' + (e as Error).message, 'error');
    }
  };

  return (
    <header className="topbar glass">
      <button className="icon-btn" onClick={onHome} title="All worlds">
        <Icon name="home" />
      </button>
      <TextField className="world-title" value={title} onCommit={(t) => t.trim() && setTitle(t.trim())} />
      <div className="sep" />
      <button className="icon-btn" disabled={!canUndo} onClick={undo} title={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Undo'}>
        <Icon name="undo" />
      </button>
      <button className="icon-btn" disabled={!canRedo} onClick={redo} title={redoLabel ? `Redo: ${redoLabel} (Ctrl+Y)` : 'Redo'}>
        <Icon name="redo" />
      </button>
      <div className="sep" />
      <Search />
      <div className="menu-wrap">
        <button className="icon-btn" onClick={() => setMenu(!menu)} title="Export">
          <Icon name="download" />
        </button>
        {menu && (
          <div className="menu glass" onMouseLeave={() => setMenu(false)}>
            <button onClick={() => exportAs('map')}>
              <Icon name="file" size={15} /> A+ World Map (.map)
            </button>
            <button onClick={() => exportAs('cmaps')}>
              <Icon name="file" size={15} /> CMaps project (.cmaps)
            </button>
            <button onClick={() => exportAs('png')}>
              <Icon name="camera" size={15} /> Image of this view (.png)
            </button>
            <button onClick={() => exportAs('geojson')}>
              <Icon name="globe" size={15} /> Regions (.geojson)
            </button>
          </div>
        )}
      </div>
    </header>
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
  const [open, setOpen] = useState(false);
  const mapStyle = useWorld((s) => s.mapStyle);
  const globe = useWorld((s) => s.globe);
  const layers = useWorld((s) => s.layers);
  return (
    <div className="layers">
      <div className="layers-buttons glass">
        <button className="icon-btn" onClick={() => useWorld.setState({ globe: !globe })} title={globe ? 'Flat map' : 'Globe'}>
          <Icon name={globe ? 'flat' : 'globe'} />
        </button>
        <button className={'icon-btn' + (open ? ' on' : '')} onClick={() => setOpen(!open)} title="Map style & layers">
          <Icon name="layers" />
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
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
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
        else if (k === '[') useWorld.setState((s) => ({ brushSize: Math.max(0, s.brushSize - 5) }));
        else if (k === ']') useWorld.setState((s) => ({ brushSize: Math.min(60, s.brushSize + 5) }));
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
