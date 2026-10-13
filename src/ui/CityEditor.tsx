import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useWorld, undo, redo, updateCity, toast } from '../world/store';
import {
  DISTRICT_COLORS,
  LINE_COLORS,
  MODES,
  addDistrict,
  addLine,
  deleteDistrict,
  deleteLine,
  deleteStation,
  districtsArea,
  districtsPop,
  districtTitle,
  lineKm,
  linesAt,
  mergeDistricts,
  networkStats,
  numberDistricts,
  openCity,
  planOf,
  removeStop,
  setUnit,
  sharePopulation,
  sortedDistricts,
  updateDistrict,
  updateLine,
  updateStation,
} from '../world/city';
import { FRESH, useCityUi, type Basemap } from '../world/cityUi';
import { CityMap, cityMap, setCityMap } from '../map/cityMap';
import { FINEST, MAIN, areaLevels, fetchAreas, shownAreas, type Candidate } from '../io/osm';
import { areasAround } from '../io/areas';
import { labelPoint } from '../geo/engine';
import type { CityPlan, District, TransitLine, TransitMode } from '../types';
import { NumberField, Stat, TextField } from './common';
import { Icon } from './icons';
import { useMobile, useOutside } from './Editor';
import { fmtCompact, fmtInt } from '../util';
import { back } from '../world/cityBack';
import './city.css';

/** The city opened up close, over the world map. */
export function CityEditor() {
  const id = useWorld((s) => s.cityView);
  const exists = useWorld((s) => id != null && !!s.doc?.cities[id]);
  // The city may vanish under the view (its creation undone).
  useEffect(() => {
    if (id != null && !exists) openCity(null);
  }, [id, exists]);
  if (id == null || !exists) return null;
  return <CityView key={id} id={id} />;
}

const BASEMAPS: [Basemap, string, string][] = [
  ['light', 'Light', 'Pale streets: districts and lines stand out'],
  ['streets', 'Streets', 'A full street map'],
  ['dark', 'Dark', 'Streets by night'],
  ['blank', 'Blank', 'No streets: an invented city, or no connection'],
];

function CityView({ id }: { id: number }) {
  const city = useWorld((s) => s.doc!.cities[id]);
  const tab = useCityUi((s) => s.tab);
  const basemap = useCityUi((s) => s.basemap);
  const canUndo = useWorld((s) => s.past.length > 0);
  const canRedo = useWorld((s) => s.future.length > 0);
  const mobile = useMobile();
  const mapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const [peek, setPeek] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useOutside(menuRef, menu, useCallback(() => setMenu(false), []));

  useEffect(() => {
    useCityUi.setState({ ...FRESH });
    const ctl = new CityMap(mapRef.current!, id);
    ctl.onReady = () => setReady(true);
    setCityMap(ctl);
    ((window as unknown as { cmaps?: Record<string, unknown> }).cmaps ??= {}).city = ctl;
    // Its quarters and the towns around are collected now, in the background; a city with no
    // district yet shows them at once, ready to be clicked.
    void collectAreas(id, false).then(() => {
      const ui = useCityUi.getState();
      if (useWorld.getState().cityView === id && ui.areas?.length && ui.tab === 'districts' && ui.tool === 'pick' && !Object.keys(planOf(id).districts).length) useCityUi.setState({ tool: 'real' });
    });
    return () => {
      setCityMap(null);
      ctl.destroy();
    };
  }, [id]);

  // The city is framed in the part of the map the panel leaves free.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      cityMap?.setInsets(mobile ? 0 : window.innerWidth - r.left, mobile ? window.innerHeight - r.top : 0);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mobile, peek]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ui = useCityUi.getState();
      const drawing = ui.tab === 'districts' && ui.tool === 'draw';
      if (e.key === 'Enter' && drawing) {
        // Not a press of whichever button was clicked last.
        e.preventDefault();
        cityMap?.finishDraft();
      } else if (e.key === 'Backspace' && drawing) cityMap?.undoDraftPoint();
      else if (e.key === 'Escape') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={'city-view' + (ready ? ' ready' : '')}>
      <div ref={mapRef} className="city-map" />
      <header className="city-bar glass">
        <button className="btn small city-back" onClick={() => openCity(null)} title="Back to the world map (Esc)">
          <Icon name="arrowLeft" size={16} /> <span className="hide-phone">World</span>
        </button>
        <TextField className="world-title" value={city.name} onCommit={(name) => name.trim() && updateCity(id, { name: name.trim() }, 'Rename city')} />
        <div className="sep" />
        <button className="icon-btn" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
          <Icon name="undo" />
        </button>
        <button className="icon-btn" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Y)">
          <Icon name="redo" />
        </button>
        <button className="icon-btn" onClick={() => cityMap?.fit()} title="Show the whole city">
          <Icon name="target" />
        </button>
        <div className="menu-wrap" ref={menuRef}>
          <button className={'icon-btn' + (menu ? ' on' : '')} onClick={() => setMenu(!menu)} title="Background map">
            <Icon name="layers" />
          </button>
          {menu && (
            <div className="menu glass">
              <div className="menu-label">Background map</div>
              {BASEMAPS.map(([b, label, desc]) => (
                <button
                  key={b}
                  className={basemap === b ? 'on' : ''}
                  title={desc}
                  onClick={() => {
                    useCityUi.setState({ basemap: b });
                    setMenu(false);
                  }}
                >
                  <Icon name={basemap === b ? 'check' : 'flat'} size={15} /> <span className="grow">{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <aside ref={panelRef} className={'city-panel glass' + (mobile ? ' sheet' : '') + (mobile && peek ? ' peek' : '')}>
        <div
          className="city-tabs"
          onClick={(e) => {
            if (mobile && !(e.target as Element).closest('button')) setPeek(!peek);
          }}
        >
          {mobile && <span className="sheet-handle" aria-hidden />}
          <div className="segmented">
            <button className={tab === 'districts' ? 'on' : ''} onClick={() => (setPeek(false), useCityUi.setState({ tab: 'districts', tool: 'pick' }))}>
              <Icon name="districts" size={16} /> Districts
            </button>
            <button className={tab === 'transit' ? 'on' : ''} onClick={() => (setPeek(false), useCityUi.setState({ tab: 'transit', tool: 'pick' }))}>
              <Icon name="train" size={16} /> Transit
            </button>
          </div>
        </div>
        <div className="city-scroll">{tab === 'districts' ? <DistrictsTab id={id} /> : <TransitTab id={id} />}</div>
      </aside>
      <CityHint id={id} />
    </div>
  );
}

function usePlan(id: number): CityPlan {
  useWorld((s) => s.doc?.plans?.[id]);
  return planOf(id);
}

/** What a click on the map does right now, said in one line at the bottom of the map. */
function CityHint({ id }: { id: number }) {
  const ui = useCityUi();
  const plan = usePlan(id);
  const mobile = useMobile();
  const tap = mobile ? 'Tap' : 'Click';
  let icon: 'pen' | 'districts' | 'train' = 'districts';
  let text = '';
  let actions: ReactNode = null;
  if (ui.tab === 'districts' && ui.tool === 'draw') {
    icon = 'pen';
    text = ui.draft === 0 ? `${tap} around the district, point by point.` : ui.draft < 3 ? 'Keep going…' : mobile ? 'Keep tapping, then Done.' : 'Keep clicking · double-click or Enter to finish · Backspace removes a point';
    actions = (
      <>
        {ui.draft > 2 && (
          <button className="btn primary small" onClick={() => cityMap?.finishDraft()}>
            Done
          </button>
        )}
        <button className="btn small" onClick={() => (cityMap?.cancelDraft(), useCityUi.setState({ tool: 'pick' }))}>
          Cancel
        </button>
      </>
    );
  } else if (ui.tab === 'districts' && ui.tool === 'real') {
    if (!ui.areas?.length) return null;
    text = ui.growing ? 'Collecting the towns around…' : `${tap} the dashed areas to add them · ${tap.toLowerCase()} anywhere further out to add the town there`;
    actions = (
      <button className="btn primary small" onClick={() => useCityUi.setState({ tool: 'pick' })}>
        Done
      </button>
    );
  } else if (ui.tab === 'transit') {
    icon = 'train';
    const line = ui.line ? plan.lines[ui.line] : undefined;
    if (!line) return null;
    text = line.stops.length ? `${tap} the map to extend ${line.name} · ${tap.toLowerCase()} the line to add a stop on it · drag a station to move it` : `${tap} the map to place the first station of ${line.name}.`;
    actions = (
      <button className="btn primary small" onClick={() => useCityUi.setState({ line: null, station: null })}>
        Done
      </button>
    );
  } else return null;
  return (
    <div className="split-hint city-hint">
      <Icon name={icon} size={16} />
      <span>{text}</span>
      {actions}
    </div>
  );
}

function Swatches({ colors, value, onChange }: { colors: string[]; value: string; onChange: (c: string) => void }) {
  return (
    <div className="color-field city-swatches">
      {colors.map((c) => (
        <button key={c} className={'swatch' + (c === value.toUpperCase() ? ' on' : '')} style={{ background: c }} onClick={() => onChange(c)} title={c} />
      ))}
      <label className="swatch custom" title="Another colour">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#cccccc'} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <Icon name="plus" size={14} />
      </label>
    </div>
  );
}

// ── Districts ────────────────────────────────────────────────────────────────

/**
 * Collects the quarters of the city and the towns around it, once: the first time the city is
 * opened (kept on the device afterwards). `show` turns them on as soon as they are there.
 */
async function collectAreas(id: number, show: boolean) {
  const city = useWorld.getState().doc?.cities[id];
  if (!city) return;
  useCityUi.setState(show ? { tool: 'real', loading: true, district: null } : { loading: true });
  let areas: Candidate[] | null = null;
  try {
    areas = await areasAround(city);
  } catch {
    /* told below, when it was asked for */
  }
  if (useWorld.getState().cityView !== id) return;
  const ui = useCityUi.getState();
  // A search of the view made meanwhile is what the user asked for last.
  if (ui.areas?.length) return useCityUi.setState({ loading: false });
  useCityUi.setState({ areas, level: MAIN, loading: false });
  // Said only when the real districts were asked for, not for the quiet collecting on opening.
  const asked = show || ui.tool === 'real';
  if (asked && !areas) toast('Could not fetch the real districts (no connection?)', 'error');
  else if (asked && areas && !areas.length) toast('No districts known here: draw your own', 'error');
}

/** Looks again, around what the map shows now (after moving far from the city). */
async function findAreas(id: number) {
  if (!cityMap) return;
  // At most ~60 km across, around the middle of the view: more would be slow and not a city.
  let [w, s, e, n] = cityMap.viewBox();
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const half = 0.3;
  [w, s, e, n] = [Math.max(w, cx - half * 1.4), Math.max(s, cy - half), Math.min(e, cx + half * 1.4), Math.min(n, cy + half)];
  useCityUi.setState({ tool: 'real', loading: true, areas: null, district: null });
  try {
    const areas = await fetchAreas([w, s, e, n]);
    if (useWorld.getState().cityView !== id) return;
    useCityUi.setState({ areas, level: MAIN, loading: false });
    if (!areas.length) toast('No districts known here: draw your own', 'error');
  } catch {
    if (useWorld.getState().cityView !== id) return;
    useCityUi.setState({ areas: [], loading: false });
    toast('Could not fetch the real districts (no connection?)', 'error');
  }
}

/** The Real districts button: what was collected when the city opened, or a first try now. */
function showAreas(id: number) {
  const ui = useCityUi.getState();
  if (ui.areas?.length) useCityUi.setState({ tool: 'real', district: null });
  else if (ui.loading) useCityUi.setState({ tool: 'real', district: null });
  else void collectAreas(id, true);
}

function RealAreas({ id }: { id: number }) {
  const ui = useCityUi();
  const plan = usePlan(id);
  const city = useWorld((s) => s.doc!.cities[id]);
  if (ui.loading)
    return (
      <div className="callout">
        <p>
          <span className="save-dot" /> Looking for the real districts around here…
        </p>
      </div>
    );
  const areas = ui.areas ?? [];
  if (!areas.length)
    return (
      <div className="callout">
        <p>Nothing found here. Move the map over the city and try again, or draw the districts yourself.</p>
        <div className="actions">
          <button className="btn small" onClick={() => findAreas(id)}>
            Search this view
          </button>
          <button className="btn small" onClick={() => useCityUi.setState({ tool: 'pick' })}>
            Close
          </button>
        </div>
      </div>
    );
  const levels = areaLevels(areas, [city.lng, city.lat]);
  const used = new Set(Object.values(plan.districts).map((d) => d.src));
  const left = shownAreas(areas, ui.level).filter((a) => !used.has(a.id));
  const addAll = () => {
    for (const a of left) addDistrict(id, a.geom, { name: a.name, pop: a.pop, src: a.id });
    toast(`${left.length} districts added`, 'ok');
  };
  return (
    <div className="callout">
      <p>
        <strong>Click the dashed areas on the map</strong> to add them to the city. Each town you add brings its own neighbours within reach, so the city can grow as far as you like — or click any spot further out to add the town there.
      </p>
      {levels.length > 1 && (
        <>
          <small className="city-label">Size of the areas</small>
          <div className="city-levels">
            <button className={'chip-btn' + (ui.level === MAIN ? ' accent' : '')} onClick={() => useCityUi.setState({ level: MAIN })} title="The arrondissements or boroughs of the city, and the towns around it">
              Main districts
            </button>
            <button className={'chip-btn' + (ui.level === FINEST ? ' accent' : '')} onClick={() => useCityUi.setState({ level: FINEST })} title="The smallest quarters known everywhere">
              Most detailed
            </button>
            {levels.map((l) => (
              <button key={l.level} className={'chip-btn' + (ui.level === l.level ? ' accent' : '')} onClick={() => useCityUi.setState({ level: l.level })} title={`${l.count} areas the size of ${l.example}`}>
                {l.count} like <strong>{l.example}</strong>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="actions">
        {left.length > 1 && (
          <button className="btn small" onClick={addAll}>
            <Icon name="plus" size={14} /> Add all {left.length}
          </button>
        )}
        <button className="btn small" onClick={() => findAreas(id)} title="Search again around what the map shows now">
          <Icon name="search" size={14} /> Search this view
        </button>
        <button className="btn primary small" onClick={() => useCityUi.setState({ tool: 'pick' })}>
          Done
        </button>
      </div>
      <p className="hint">Areas from OpenStreetMap contributors.</p>
    </div>
  );
}

function DistrictCard({ id, d, plan }: { id: number; d: District; plan: CityPlan }) {
  const others = sortedDistricts(plan).filter((o) => o.id !== d.id);
  return (
    <div className="city-card" style={{ '--c': d.color } as CSSProperties}>
      <div className="city-card-head">
        <input
          className="city-num"
          inputMode="numeric"
          placeholder="№"
          title="Its number in the city"
          key={d.id + ':' + (d.num ?? '')}
          defaultValue={d.num ?? ''}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          onBlur={(e) => {
            const v = e.target.value.trim();
            const num = v === '' ? undefined : Math.round(Number(v));
            if (num !== d.num && (num === undefined || Number.isFinite(num))) updateDistrict(id, d.id, { num }, 'Number the district');
          }}
        />
        <TextField className="title-input" value={d.name} onCommit={(name) => name.trim() && updateDistrict(id, d.id, { name: name.trim() }, 'Rename district')} />
        <button className="icon-btn" onClick={() => useCityUi.setState({ district: null })} title="Close">
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="stats compact">
        <Stat label="Population">
          <NumberField value={d.pop ?? 0} onCommit={(pop) => updateDistrict(id, d.id, { pop: pop > 0 ? Math.round(pop) : undefined }, 'Set district population')} />
        </Stat>
        <Stat label="Area">{d.area >= 10 ? fmtInt(d.area) : d.area.toFixed(2)} km²</Stat>
        {d.pop ? <Stat label="Density">{fmtInt(d.pop / d.area)} /km²</Stat> : null}
      </div>
      <Swatches colors={DISTRICT_COLORS} value={d.color} onChange={(color) => updateDistrict(id, d.id, { color }, 'Colour the district')} />
      <TextField multiline className="city-notes" value={d.notes ?? ''} placeholder="What is it like? Landmarks, people, history…" onCommit={(notes) => updateDistrict(id, d.id, { notes: notes.trim() || undefined }, 'Edit lore')} />
      <div className="actions">
        {others.length > 0 && (
          <select
            className="city-select"
            value=""
            title="Fuse another district into this one"
            onChange={(e) => {
              if (e.target.value) mergeDistricts(id, [d.id, e.target.value]);
            }}
          >
            <option value="">Merge with…</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {districtTitle(o)}
              </option>
            ))}
          </select>
        )}
        <button
          className="btn ghost danger small"
          onClick={() => {
            deleteDistrict(id, d.id);
            useCityUi.setState({ district: null });
          }}
        >
          <Icon name="trash" size={14} /> Remove
        </button>
      </div>
    </div>
  );
}

function DistrictsTab({ id }: { id: number }) {
  const city = useWorld((s) => s.doc!.cities[id]);
  const plan = usePlan(id);
  const ui = useCityUi();
  const list = sortedDistricts(plan);
  const sel = ui.district ? plan.districts[ui.district] : undefined;
  const area = districtsArea(plan);
  const sum = districtsPop(plan);
  const pop = city.pop ?? 0;
  const unit = plan.unit ?? 'District';
  return (
    <div className="city-body">
      <div className="stats compact">
        <Stat label="Population">
          <NumberField value={pop} onCommit={(v) => updateCity(id, { pop: v > 0 ? Math.round(v) : undefined }, 'Set city population')} />
        </Stat>
        <Stat label={`${unit}s`}>{list.length}</Stat>
        {area > 0 && <Stat label="Area">{area >= 10 ? fmtInt(area) : area.toFixed(1)} km²</Stat>}
        {area > 0 && pop > 0 && <Stat label="Density">{fmtInt(pop / area)} /km²</Stat>}
      </div>

      {list.length > 0 && pop > 0 && sum !== pop && (
        <div className="callout city-pop">
          <p>{sum ? `The districts add up to ${fmtCompact(sum)}, the city has ${fmtCompact(pop)}.` : `Nobody lives in the districts yet: the city has ${fmtCompact(pop)} people.`}</p>
          <div className="actions">
            <button className="btn primary small" onClick={() => sharePopulation(id, pop)} title={sum ? 'Each district keeps its share of the total' : 'By area, to start with'}>
              <Icon name="people" size={14} /> Share {fmtCompact(pop)} among them
            </button>
            {sum > 0 && (
              <button className="btn small" onClick={() => updateCity(id, { pop: sum }, 'Set city population')}>
                City = {fmtCompact(sum)}
              </button>
            )}
          </div>
        </div>
      )}
      {list.length > 0 && !pop && sum > 0 && (
        <button className="btn small" onClick={() => updateCity(id, { pop: sum }, 'Set city population')}>
          <Icon name="people" size={14} /> Use the districts’ total for the city: {fmtCompact(sum)}
        </button>
      )}

      {sel && <DistrictCard id={id} d={sel} plan={plan} />}

      <div className="city-actions">
        <button className={'city-action' + (ui.tool === 'real' ? ' on' : '')} onClick={() => (ui.tool === 'real' ? useCityUi.setState({ tool: 'pick' }) : showAreas(id))}>
          <Icon name="globe" size={20} />
          <strong>Real districts</strong>
          <small>{ui.areas?.length ? `${ui.areas.length} quarters and towns around, ready` : ui.loading ? 'Collecting the quarters and towns around…' : 'The quarters and the towns around'}</small>
        </button>
        <button className={'city-action' + (ui.tool === 'draw' ? ' on' : '')} onClick={() => useCityUi.setState({ tool: ui.tool === 'draw' ? 'pick' : 'draw', district: null })}>
          <Icon name="pen" size={20} />
          <strong>Draw one</strong>
          <small>Your own shape, cut out of the others</small>
        </button>
      </div>
      {ui.tool === 'real' && <RealAreas id={id} />}

      {list.length > 0 ? (
        <>
          <div className="city-list">
            {list.map((d) => (
              <button
                key={d.id}
                className={ui.district === d.id ? 'on' : ''}
                onClick={() => {
                  useCityUi.setState({ district: d.id, tool: 'pick' });
                  const p = labelPoint(d.geom);
                  if (p) cityMap?.flyTo(p);
                }}
              >
                <span className="city-badge" style={{ background: d.color }}>
                  {d.num ?? ''}
                </span>
                <span className="grow name">{d.name}</span>
                {d.pop ? <small>{fmtCompact(d.pop)}</small> : null}
              </button>
            ))}
          </div>
          <div className="city-foot">
            <label className="field-row">
              <span>They are called</span>
              <TextField value={unit} placeholder="Arrondissement, Quartier, Borough…" onCommit={(v) => setUnit(id, v)} />
            </label>
            <button className="btn small" onClick={() => numberDistricts(id)} title="1 at the centre, then outwards">
              <Icon name="list" size={14} /> Number them from the centre
            </button>
          </div>
        </>
      ) : (
        ui.tool === 'pick' && <p className="hint city-empty">This city has no districts yet. Fetch the real ones to start from, or draw your own — then rename, number, merge and populate them as you like.</p>
      )}
    </div>
  );
}

// ── Transit ──────────────────────────────────────────────────────────────────

const MODE_LIST = Object.keys(MODES) as TransitMode[];

function LineCard({ id, line, plan }: { id: number; line: TransitLine; plan: CityPlan }) {
  const station = useCityUi((s) => s.station);
  return (
    <div className="city-card" style={{ '--c': line.color } as CSSProperties}>
      <div className="city-card-head">
        <span className="city-bullet" style={{ background: line.color }} />
        <TextField className="title-input" value={line.name} onCommit={(name) => name.trim() && updateLine(id, line.id, { name: name.trim() }, 'Rename line')} />
        <button className="icon-btn" onClick={() => useCityUi.setState({ line: null, station: null })} title="Done with this line">
          <Icon name="check" size={16} />
        </button>
      </div>
      <div className="segmented">
        {MODE_LIST.map((m) => (
          <button key={m} className={line.mode === m ? 'on' : ''} onClick={() => updateLine(id, line.id, { mode: m }, 'Change line type')}>
            {MODES[m].label}
          </button>
        ))}
      </div>
      <Swatches colors={LINE_COLORS} value={line.color} onChange={(color) => updateLine(id, line.id, { color }, 'Colour the line')} />
      {line.stops.length ? (
        <ol className="city-stops">
          {line.stops.map((sid, i) => {
            const s = plan.stations[sid];
            if (!s) return null;
            const hub = linesAt(plan, sid).filter((l) => l.id !== line.id);
            return (
              <li key={sid + i} className={station === sid ? 'on' : ''}>
                <button
                  className="grow"
                  onClick={() => {
                    useCityUi.setState({ station: sid });
                    cityMap?.flyTo([s.lng, s.lat]);
                  }}
                >
                  <span className="stop-dot" />
                  <span className="name">{s.name}</span>
                  {hub.map((l) => (
                    <span key={l.id} className="city-chip" style={{ background: l.color }}>
                      {l.name}
                    </span>
                  ))}
                </button>
                <button className="icon-btn" onClick={() => removeStop(id, line.id, sid)} title={`Take ${s.name} off the line`}>
                  <Icon name="x" size={13} />
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="hint">No station yet: click the map to place the first one.</p>
      )}
      <div className="actions">
        {line.stops.length > 1 && (
          <button className="btn small" onClick={() => updateLine(id, line.id, { stops: [...line.stops].reverse() }, 'Reverse the line')} title="List the stops from the other end">
            <Icon name="shuffle" size={14} /> Reverse
          </button>
        )}
        <button
          className="btn ghost danger small"
          onClick={() => {
            deleteLine(id, line.id);
            useCityUi.setState({ line: null, station: null });
          }}
        >
          <Icon name="trash" size={14} /> Delete line
        </button>
      </div>
    </div>
  );
}

function StationCard({ id, sid, plan }: { id: number; sid: string; plan: CityPlan }) {
  const s = plan.stations[sid];
  if (!s) return null;
  const on = linesAt(plan, sid);
  return (
    <div className="city-card station">
      <div className="city-card-head">
        <span className="stop-dot big" />
        <TextField className="title-input" value={s.name} autoFocus={/^Station \d+$/.test(s.name)} onCommit={(name) => name.trim() && updateStation(id, sid, { name: name.trim() }, 'Rename station')} />
        <button className="icon-btn" onClick={() => useCityUi.setState({ station: null })} title="Close">
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="city-on">
        {on.map((l) => (
          <button key={l.id} className="city-chip" style={{ background: l.color }} onClick={() => useCityUi.setState({ line: l.id })} title={`Work on ${l.name}`}>
            {l.name}
          </button>
        ))}
        {on.length > 1 && <small>Interchange</small>}
        <span className="grow" />
        <button
          className="btn ghost danger small"
          onClick={() => {
            deleteStation(id, sid);
            useCityUi.setState({ station: null });
          }}
        >
          <Icon name="trash" size={14} /> Remove
        </button>
      </div>
    </div>
  );
}

function TransitTab({ id }: { id: number }) {
  const plan = usePlan(id);
  const ui = useCityUi();
  const lines = Object.values(plan.lines);
  const stats = networkStats(plan);
  const active = ui.line ? plan.lines[ui.line] : undefined;
  const [mode, setMode] = useState<TransitMode>('metro');
  return (
    <div className="city-body">
      <div className="stats compact">
        <Stat label="Lines">{stats.lines}</Stat>
        <Stat label="Stations">{stats.stations}</Stat>
        <Stat label="Network">{stats.km.toFixed(1)} km</Stat>
      </div>

      {ui.station && plan.stations[ui.station] && <StationCard id={id} sid={ui.station} plan={plan} />}
      {active && <LineCard id={id} line={active} plan={plan} />}

      {lines.length > 0 && (
        <div className="city-list">
          {lines.map((l) => (
            <button key={l.id} className={ui.line === l.id ? 'on' : ''} onClick={() => useCityUi.setState({ line: ui.line === l.id ? null : l.id, station: null })}>
              <span className="city-chip" style={{ background: l.color }}>
                {l.name}
              </span>
              <span className="grow name">{MODES[l.mode].label}</span>
              <small>
                {l.stops.length} stop{l.stops.length === 1 ? '' : 's'} · {lineKm(plan, l).toFixed(1)} km
              </small>
            </button>
          ))}
        </div>
      )}

      <div className="city-new">
        <div className="segmented">
          {MODE_LIST.map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {MODES[m].label}
            </button>
          ))}
        </div>
        <button className="btn primary wide" onClick={() => useCityUi.setState({ line: addLine(id, mode), station: null })}>
          <Icon name="plus" size={16} /> New {MODES[mode].label.toLowerCase()} line
        </button>
      </div>
      {!lines.length && <p className="hint city-empty">Create a line, then click the map to place its stations one after the other. Click a station of another line to make an interchange.</p>}
    </div>
  );
}
