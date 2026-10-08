import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
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
  boundsOf,
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
import { FlagMaker } from './FlagMaker';
import { CountryPicker, Flag, TextField } from './common';
import type { LngLat } from '../types';
import { Icon, type IconName } from './icons';
import { downloadMap, fileBase } from '../io/files';
import { flushAutosave, onSaveState } from '../world/persist';
import { download, fmtCompact } from '../util';

export function Editor({ onHome }: { onHome: () => void }) {
  useShortcuts();
  const details = useWorld((s) => s.detailsOpen);
  const [ready, setReady] = useState(false);
  // Never keep the editor behind the veil, even if the map cannot load (e.g. no WebGL).
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 10_000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className={'editor' + (details ? ' details-open' : '') + (ready ? ' ready' : '')}>
      <MapView onReady={() => setReady(true)} />
      <LoadingVeil ready={ready} />
      <TopBar onHome={onHome} />
      <ToolDock />
      <Inspector />
      <LayersPanel />
      <SelectionBubble />
      <DetailsDock />
      <HoverTip />
      <SplitHint />
      <ShortcutsHelp />
      <AdvancedPanel />
      <FlagGallery />
      <FlagLightbox />
      <FlagMaker />
    </div>
  );
}

function MapView({ onReady }: { onReady: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  useEffect(() => {
    const ctl = new MapController(ref.current!);
    ctl.onReady = () => readyRef.current();
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

const LOADING_STEPS = ['Unrolling the map', 'Drawing borders', 'Raising mountains', 'Filling the oceans', 'Naming places'];

/** Covers the map while it loads, then fades away; the world's name and a few status lines meanwhile. */
function LoadingVeil({ ready }: { ready: boolean }) {
  const title = useWorld((s) => s.doc?.meta.title ?? '');
  const [step, setStep] = useState(0);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (ready) {
      const t = setTimeout(() => setGone(true), 700);
      return () => clearTimeout(t);
    }
    const t = setInterval(() => setStep((s) => Math.min(LOADING_STEPS.length - 1, s + 1)), 650);
    return () => clearInterval(t);
  }, [ready]);
  if (gone) return null;
  return (
    <div className={'loading-veil' + (ready ? ' out' : '')} aria-busy={!ready}>
      <div className="boot-globe" />
      <strong>{title}</strong>
      <span className="loading-step" key={step}>
        {LOADING_STEPS[step]}…
      </span>
    </div>
  );
}

/** Closes a popover when the user presses anywhere outside `ref`. */
export function useOutside(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [ref, open, close]);
}

export function useMobile() {
  const q = '(max-width: 760px)';
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const f = () => setM(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return m;
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
  const menuRef = useRef<HTMLDivElement>(null);
  useOutside(menuRef, menu, useCallback(() => setMenu(false), []));
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
      <div className="menu-wrap" ref={menuRef}>
        <button className={'icon-btn' + (menu ? ' on' : '')} onClick={() => setMenu(!menu)} title="Export">
          <Icon name="download" />
        </button>
        {menu && (
          <div className="menu glass">
            <div className="menu-label">Export</div>
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
      <div className="tools glass" style={{ '--i': TOOLS.findIndex((t) => t.id === tool) } as CSSProperties}>
        <span className="tool-indicator" aria-hidden />
        {TOOLS.map((t) => (
          <button key={t.id} className={'tool' + (tool === t.id ? ' on' : '')} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`} aria-label={t.label}>
            <Icon name={t.icon} size={20} />
            <span className="tool-tip">
              {t.label} <kbd>{t.key}</kbd>
            </span>
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


/** What the selection is, for the bubble and the details window. */
function useSelectionView() {
  const sel = useWorld((s) => s.selection);
  const doc = useWorld((s) => s.doc)!;
  const agg = countryAggregates(doc);
  if (sel.city != null && doc.cities[sel.city]) {
    const c = doc.cities[sel.city];
    const of = Object.values(doc.countries).find((k) => k.capital === c.id);
    return { key: `city:${c.id}`, kind: 'City', title: c.name, sub: of ? `Capital of ${of.name}` : c.capital ? 'Capital' : 'City', anchor: sel.anchor ?? ([c.lng, c.lat] as LngLat), body: <CityPanel id={c.id} /> };
  }
  if (sel.regions.length > 1) {
    const first = doc.regions[sel.regions[0]];
    return { key: 'multi', kind: 'Selection', title: `${sel.regions.length} regions`, sub: 'Give away, merge or found a country', anchor: sel.anchor ?? ([first?.cx ?? 0, first?.cy ?? 0] as LngLat), body: <MultiRegionPanel ids={sel.regions} /> };
  }
  const region = sel.regions.length === 1 ? doc.regions[sel.regions[0]] : undefined;
  if (sel.cid && doc.countries[sel.cid]) {
    const c = doc.countries[sel.cid];
    const a = agg[c.cid];
    const popKey = doc.settings.stats.find((s) => s.scale)?.key;
    const facts = [a ? fmtCompact(a.area) + ' km²' : null, popKey && a?.vals[popKey] ? fmtCompact(a.vals[popKey]) + ' people' : null].filter(Boolean).join(' · ');
    return {
      key: `country:${c.cid}`,
      kind: 'Country',
      title: c.name,
      flag: c,
      sub: region ? region.name : facts,
      anchor: sel.anchor ?? (region ? ([region.cx, region.cy] as LngLat) : c.label ?? ([0, 0] as LngLat)),
      body: <CountryPanel cid={c.cid} />,
    };
  }
  if (region)
    return {
      key: `region:${region.id}`,
      kind: 'Region',
      title: region.name,
      sub: 'Unclaimed land',
      anchor: sel.anchor ?? ([region.cx, region.cy] as LngLat),
      body: (
        <div className="panel-body">
          <RegionCard region={region} />
        </div>
      ),
    };
  return null;
}

/** True when `p` is on the hidden hemisphere of the globe (more than ~80° of arc from the view centre). */
function farSide(center: { lng: number; lat: number }, p: LngLat, globe: boolean) {
  if (!globe) return false;
  const r = Math.PI / 180;
  const cos = Math.sin(center.lat * r) * Math.sin(p[1] * r) + Math.cos(center.lat * r) * Math.cos(p[1] * r) * Math.cos((p[0] - center.lng) * r);
  return cos < Math.cos(80 * r);
}

/** A small card pointing at the selection on the map; opens the full details. */
function SelectionBubble() {
  const view = useSelectionView();
  const tool = useWorld((s) => s.tool);
  const details = useWorld((s) => s.detailsOpen);
  const ref = useRef<HTMLDivElement>(null);
  const anchor = view?.anchor;
  useEffect(() => {
    const map = mapCtl?.map;
    if (!map || !anchor) return;
    let raf = 0;
    const place = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const p = map.project(anchor);
      const c = map.getContainer();
      // Hidden when its spot is off screen or on the far side of the globe.
      const hidden = p.x < 0 || p.y < 0 || p.x > c.clientWidth || p.y > c.clientHeight || farSide(map.getCenter(), anchor, useWorld.getState().globe);
      el.style.visibility = hidden ? 'hidden' : '';
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    };
    const queue = () => (raf ||= requestAnimationFrame(place));
    place();
    map.on('move', queue);
    map.on('resize', queue);
    return () => {
      map.off('move', queue);
      map.off('resize', queue);
      cancelAnimationFrame(raf);
    };
  }, [anchor, view?.key]);
  if (!view || details || (tool !== 'select' && tool !== 'city')) return null;
  return (
    <div ref={ref} className="sel-bubble-anchor">
      <div className="sel-bubble glass" key={view.key + (view.sub ?? '')}>
        <button className="sel-bubble-main" onClick={() => useWorld.setState({ detailsOpen: true })} title="Open the details">
          {view.flag ? <Flag country={view.flag} size={26} /> : <span className="sel-bubble-icon"><Icon name={view.kind === 'City' ? 'city' : 'flat'} size={16} /></span>}
          <span className="grow">
            <strong>{view.title}</strong>
            {view.sub && <small>{view.sub}</small>}
          </span>
          <span className="sel-bubble-go">
            Details <Icon name="chevron" size={14} />
          </span>
        </button>
        <button className="icon-btn sel-bubble-x" onClick={() => select({})} title="Close (Esc)">
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}

/**
 * Reports how much of the screen a docked panel covers, so the map centres and fits things in
 * the part that stays visible (see MapController.updatePadding).
 */
function useDockInset(id: string, ref: RefObject<HTMLElement | null>, active: boolean, mobile: boolean) {
  useEffect(() => {
    const el = ref.current;
    const put = (v: { right: number; bottom: number } | null) =>
      useWorld.setState((s) => {
        const docks = { ...s.docks };
        if (v) docks[id] = v;
        else delete docks[id];
        return { docks };
      });
    if (!active || !el) {
      put(null);
      return;
    }
    const report = () => {
      const r = el.getBoundingClientRect();
      const v = mobile ? { right: 0, bottom: Math.max(0, window.innerHeight - r.top) } : { right: Math.max(0, window.innerWidth - r.left), bottom: 0 };
      const cur = useWorld.getState().docks[id];
      if (!cur || cur.right !== v.right || cur.bottom !== v.bottom) put(v);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener('resize', report);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', report);
      put(null);
    };
  }, [id, ref, active, mobile]);
}

/** Frames the current selection in the visible part of the map. */
function focusSelection() {
  const { selection: sel, doc } = useWorld.getState();
  if (!doc || !mapCtl) return;
  if (sel.city != null && doc.cities[sel.city]) {
    const c = doc.cities[sel.city];
    mapCtl.centerOn([c.lng, c.lat]);
  } else if (sel.cid && doc.countries[sel.cid]) mapCtl.fitBounds(countryBounds(sel.cid), 6, { keepDetails: true });
  else if (sel.regions.length) mapCtl.fitBounds(boundsOf(sel.regions), 7, { keepDetails: true });
}

/** The selection's full page, docked beside the map (below it on phones) so the map stays in view. */
function DetailsDock() {
  const open = useWorld((s) => s.detailsOpen);
  const view = useSelectionView();
  const mobile = useMobile();
  const ref = useRef<HTMLElement>(null);
  const shown = open && !!view;
  useDockInset('details', ref, shown, mobile);
  const key = view?.key;
  useEffect(() => {
    if (!shown) return;
    // After the dock has reported its size, so the fit uses the visible part of the map.
    const id = requestAnimationFrame(() => requestAnimationFrame(focusSelection));
    return () => cancelAnimationFrame(id);
  }, [shown, key]);
  if (!shown || !view) return null;
  return (
    <aside ref={ref} className={'dock details-dock glass' + (mobile ? ' dock-bottom' : '')}>
      <div className="dock-head">
        <span className="details-kind">{view.kind}</span>
        <div className="grow" />
        <button className="icon-btn" onClick={() => useWorld.setState({ detailsOpen: false })} title="Close (Esc)">
          <Icon name="x" />
        </button>
      </div>
      <div className="dock-scroll page" key={view.key}>
        {view.body}
      </div>
    </aside>
  );
}

/** The world overview: a side panel on desktop; on phones a panel opened from a button, so the map gets the whole screen. */
function Inspector() {
  const doc = useWorld((s) => s.doc)!;
  const mobile = useMobile();
  const details = useWorld((s) => s.detailsOpen && !!(s.selection.cid || s.selection.regions.length || s.selection.city != null));
  const worldOpen = useWorld((s) => s.worldOpen);
  const [collapsed, setCollapsed] = useState(false);
  const ref = useRef<HTMLElement>(null);
  // The details panel takes the same place.
  const shown = !details && (mobile ? worldOpen : true);
  useDockInset('world', ref, shown && !(collapsed && !mobile), mobile);
  const countries = Object.keys(doc.countries).length;

  if (!shown)
    return mobile && !details ? (
      <button className="world-fab glass" onClick={() => useWorld.setState({ worldOpen: true })}>
        <Icon name="list" size={17} />
        <span>
          {doc.meta.title} · {countries} countries
        </span>
      </button>
    ) : null;
  return (
    <aside ref={ref} className={'inspector dock glass' + (mobile ? ' dock-bottom' : '') + (collapsed && !mobile ? ' collapsed' : '')}>
      <div className="inspector-head">
        <span className="head-icon">
          <Icon name="globe" />
        </span>
        <h2 className="grow">{doc.meta.title}</h2>
        {mobile ? (
          <button className="icon-btn" onClick={() => useWorld.setState({ worldOpen: false })} title="Close">
            <Icon name="x" />
          </button>
        ) : (
          <button className="icon-btn collapse-btn" onClick={() => setCollapsed(!collapsed)} title={collapsed ? 'Expand' : 'Collapse'}>
            <Icon name="chevronDown" className={'chev' + (collapsed ? '' : ' up')} />
          </button>
        )}
      </div>
      <div className="inspector-scroll">
        <div className="page">
          <WorldPanel />
        </div>
      </div>
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
  ['waves', 'Animated water'],
  ['rivers', 'Rivers'],
  ['urban', 'Urban areas'],
  ['graticule', 'Graticule'],
];

function LayersPanel() {
  const open = useWorld((s) => s.layersOpen);
  const setOpen = useCallback((v: boolean) => useWorld.setState({ layersOpen: v }), []);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, open, useCallback(() => setOpen(false), [setOpen]));
  const mapStyle = useWorld((s) => s.mapStyle);
  const globe = useWorld((s) => s.globe);
  const layers = useWorld((s) => s.layers);
  return (
    <div className="layers" ref={ref}>
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
          <div className="menu-label">Map style</div>
          <div className="style-grid">
            {STYLES.map((s) => (
              <button key={s.id} className={'style-chip ' + s.id + (mapStyle === s.id ? ' on' : '')} onClick={() => useWorld.setState({ mapStyle: s.id })} title={s.desc}>
                <span className="style-preview" />
                {s.label}
              </button>
            ))}
          </div>
          <div className="menu-label">Show on the map</div>
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
        else if (k === 'escape' && useWorld.getState().flagMakerFor) useWorld.setState({ flagMakerFor: null });
        else if (k === 'escape' && useWorld.getState().detailsOpen) useWorld.setState({ detailsOpen: false });
        else if (k === 'escape' && useWorld.getState().worldOpen) useWorld.setState({ worldOpen: false });
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
