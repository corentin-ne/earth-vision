import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Country, WorldDoc } from '../types';
import { useWorld, countryAggregates, select, countryBounds, toast, type Thematic } from '../world/store';
import { computeThematic, thematicKey, thematicOptions } from '../world/thematic';
import { applyFindReplace, findReplace, type FindScope } from '../world/edits';
import { OVERLAYS, isCached } from '../map/overlays';
import { mapCtl } from '../map/controller';
import { Flag } from './common';
import { Icon, type IconName } from './icons';
import { fmtArea, fmtCompact, fmtInt } from '../util';

// ── Window frame ─────────────────────────────────────────────────────────────

export function Window({ icon, title, onClose, children, wide }: { icon: IconName; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={'modal glass' + (wide ? ' wide' : '')} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="modal-head">
          <Icon name={icon} />
          <h2 className="grow">{title}</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Thematic map ─────────────────────────────────────────────────────────────

export function setThematic(t: Thematic | null) {
  useWorld.setState(t ? { thematic: t, allianceView: null } : { thematic: null });
}

/** "Colour the map by" select, for the layers popover. */
export function ThematicPicker() {
  const doc = useWorld((s) => s.doc)!;
  const thematic = useWorld((s) => s.thematic);
  const opts = useMemo(() => thematicOptions(doc), [doc.settings]);
  return (
    <select
      className="thematic-select"
      value={thematicKey(thematic)}
      onChange={(e) => setThematic(e.target.value ? (JSON.parse(e.target.value) as Thematic) : null)}
    >
      <option value="">Countries (their own colours)</option>
      {opts.map((o) => (
        <option key={thematicKey(o.value)} value={thematicKey(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ThematicLegend() {
  const thematic = useWorld((s) => s.thematic);
  const alliances = useWorld((s) => s.allianceView);
  const doc = useWorld((s) => s.doc);
  if (!thematic || alliances || !doc) return null;
  const res = computeThematic(doc, thematic);
  return (
    <div className="alliance-legend thematic-legend glass">
      <div className="legend-head">
        <Icon name="palette" size={15} />
        <strong className="grow">{res.title}</strong>
        <button className="icon-btn" title="Back to countries" onClick={() => setThematic(null)}>
          <Icon name="x" size={14} />
        </button>
      </div>
      {res.legend.map((l, i) => (
        <div key={i} className="legend-row static">
          <span className="swatch-mini" style={{ background: l.color }} />
          <span className="grow">{l.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Statistics ───────────────────────────────────────────────────────────────

interface Metric {
  key: string;
  label: string;
  value: (c: Country) => number | null;
  fmt: (v: number) => string;
}

function metricsOf(doc: WorldDoc): Metric[] {
  const agg = countryAggregates(doc);
  const pop = doc.settings.stats.find((s) => s.scale)?.key;
  const out: Metric[] = [
    { key: 'area', label: 'Area', value: (c) => agg[c.cid]?.area ?? 0, fmt: (v) => fmtArea(v) },
    { key: 'regions', label: 'Regions', value: (c) => agg[c.cid]?.regions ?? 0, fmt: fmtInt },
  ];
  for (const s of doc.settings.stats) {
    out.push({ key: `s:${s.key}`, label: s.key, value: (c) => (s.scale ? agg[c.cid]?.vals[s.key] ?? 0 : c.stats[s.key] ?? 0), fmt: fmtCompact });
  }
  if (pop) {
    out.push({ key: 'density', label: `${pop} per km²`, value: (c) => (agg[c.cid]?.area ? (agg[c.cid].vals[pop] ?? 0) / agg[c.cid].area : null), fmt: (v) => v.toFixed(1) });
    for (const s of doc.settings.stats)
      if (s.key !== pop)
        out.push({
          key: `pc:${s.key}`,
          label: `${s.key} per person`,
          value: (c) => {
            const p = agg[c.cid]?.vals[pop] ?? 0;
            const v = s.scale ? agg[c.cid]?.vals[s.key] ?? 0 : c.stats[s.key] ?? 0;
            return p > 0 ? v / p : null;
          },
          fmt: (v) => (v < 100 ? v.toFixed(2) : fmtCompact(v)),
        });
  }
  out.push({ key: 'states', label: 'States', value: (c) => Object.keys(c.states ?? {}).length, fmt: fmtInt });
  out.push({ key: 'vassals', label: 'Vassals', value: (c) => Object.values(doc.countries).filter((v) => v.overlord === c.cid).length, fmt: fmtInt });
  return out;
}

export function StatsWindow() {
  const open = useWorld((s) => s.statsOpen);
  if (!open) return null;
  return <StatsBody />;
}

function StatsBody() {
  const doc = useWorld((s) => s.doc)!;
  const close = () => useWorld.setState({ statsOpen: false });
  const [tab, setTab] = useState<'rank' | 'compare'>('rank');
  const metrics = useMemo(() => metricsOf(doc), [doc]);
  const [mk, setMk] = useState('area');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>(() => {
    const sel = useWorld.getState().selection.cid;
    return sel ? [sel] : [];
  });
  const agg = countryAggregates(doc);
  const owned = Object.values(doc.countries).filter((c) => agg[c.cid]?.regions);
  const metric = metrics.find((m) => m.key === mk) ?? metrics[0];
  const rows = useMemo(() => {
    const list = owned.map((c) => ({ c, v: metric.value(c) })).filter((x): x is { c: Country; v: number } => x.v != null);
    list.sort((a, b) => b.v - a.v);
    return list;
  }, [owned.length, metric, doc]);
  const max = rows[0]?.v || 1;
  const total = rows.reduce((t, r) => t + r.v, 0);
  const ql = q.trim().toLowerCase();
  const go = (cid: string) => {
    close();
    select({ cid });
    mapCtl?.fitBounds(countryBounds(cid));
  };
  return (
    <Window icon="chart" title="Statistics" onClose={close} wide>
      <div className="segmented stats-tabs">
        <button className={tab === 'rank' ? 'on' : ''} onClick={() => setTab('rank')}>
          Rankings
        </button>
        <button className={tab === 'compare' ? 'on' : ''} onClick={() => setTab('compare')}>
          Compare countries
        </button>
      </div>
      {tab === 'rank' ? (
        <>
          <div className="list-tools">
            <select value={mk} onChange={(e) => setMk(e.target.value)}>
              {metrics.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
            <div className="search-mini">
              <Icon name="search" size={14} />
              <input placeholder="Find a country" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            </div>
          </div>
          <div className="rank-list">
            {rows.map(({ c, v }, i) =>
              ql && !c.name.toLowerCase().includes(ql) ? null : (
                <button key={c.cid} className="rank-row" onClick={() => go(c.cid)}>
                  <span className="rank">{i + 1}</span>
                  <Flag country={c} size={14} />
                  <span className="rank-name">{c.name}</span>
                  <span className="rank-bar">
                    <span style={{ width: `${Math.max(1, (v / max) * 100)}%`, background: c.color }} />
                  </span>
                  <small>{metric.fmt(v)}</small>
                  {!mk.startsWith('pc:') && mk !== 'density' && total > 0 && <small className="share">{((v / total) * 100).toFixed(1)}%</small>}
                </button>
              ),
            )}
            {!rows.length && <p className="hint">No country has this figure yet.</p>}
          </div>
        </>
      ) : (
        <Compare metrics={metrics} picked={picked} setPicked={setPicked} doc={doc} />
      )}
    </Window>
  );
}

function Compare({ metrics, picked, setPicked, doc }: { metrics: Metric[]; picked: string[]; setPicked: (p: string[]) => void; doc: WorldDoc }) {
  const [adding, setAdding] = useState('');
  const countries = picked.map((cid) => doc.countries[cid]).filter(Boolean);
  const agg = countryAggregates(doc);
  const options = Object.values(doc.countries)
    .filter((c) => agg[c.cid]?.regions && !picked.includes(c.cid))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="compare">
      <div className="compare-pick">
        {countries.map((c) => (
          <span key={c.cid} className="chip">
            <span className="chip-main">
              <Flag country={c} size={12} /> {c.name}
            </span>
            <button className="chip-x" onClick={() => setPicked(picked.filter((x) => x !== c.cid))}>
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
        {picked.length < 5 && (
          <select
            value={adding}
            onChange={(e) => {
              if (e.target.value) setPicked([...picked, e.target.value]);
              setAdding('');
            }}
          >
            <option value="">Add a country…</option>
            {options.map((c) => (
              <option key={c.cid} value={c.cid}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {countries.length > 0 ? (
        <div className="compare-table">
          {metrics.map((m) => {
            const vals = countries.map((c) => m.value(c));
            const max = Math.max(...vals.map((v) => v ?? 0)) || 1;
            return (
              <div key={m.key} className="compare-metric">
                <h4>{m.label}</h4>
                {countries.map((c, i) => (
                  <div key={c.cid} className="compare-row">
                    <span className="rank-name">{c.name}</span>
                    <span className="rank-bar">
                      <span style={{ width: `${vals[i] ? Math.max(1, (vals[i]! / max) * 100) : 0}%`, background: c.color }} />
                    </span>
                    <small>{vals[i] == null ? '—' : m.fmt(vals[i]!)}</small>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="hint">Add two or more countries to compare them side by side.</p>
      )}
    </div>
  );
}

// ── Find & replace ───────────────────────────────────────────────────────────

const SCOPES: [keyof FindScope, string][] = [
  ['countries', 'Country & state names'],
  ['regions', 'Region names'],
  ['cities', 'City names'],
  ['fields', 'Details (leader, language…)'],
  ['notes', 'Lore & notes'],
  ['marks', 'Names, routes & pins on the map'],
];

export function FindReplaceWindow() {
  const open = useWorld((s) => s.findOpen);
  if (!open) return null;
  return <FindReplaceBody />;
}

function FindReplaceBody() {
  useWorld((s) => s.doc);
  const close = () => useWorld.setState({ findOpen: false });
  const [find, setFind] = useState('');
  const [repl, setRepl] = useState('');
  const [scope, setScope] = useState<FindScope>({ countries: true, regions: true, cities: true, fields: true, notes: true, marks: true });
  const [opts, setOpts] = useState({ matchCase: false, wholeWord: false });
  const { hits } = findReplace(find, repl, scope, opts);
  const apply = () => {
    const n = applyFindReplace(find, repl, scope, opts);
    toast(n ? `Replaced in ${n} place${n > 1 ? 's' : ''} (Ctrl+Z to undo)` : 'Nothing to replace', n ? 'ok' : undefined);
  };
  return (
    <Window icon="replace" title="Find & replace" onClose={close}>
      <div className="find-form" onKeyDown={(e) => e.stopPropagation()}>
        <input autoFocus placeholder="Find…" value={find} onChange={(e) => setFind(e.target.value)} />
        <input placeholder="Replace with…" value={repl} onChange={(e) => setRepl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && hits.length && apply()} />
      </div>
      <div className="toggles find-scopes">
        {SCOPES.map(([k, label]) => (
          <label key={k} className="toggle">
            <input type="checkbox" checked={scope[k]} onChange={(e) => setScope({ ...scope, [k]: e.target.checked })} />
            <span className="switch" />
            {label}
          </label>
        ))}
        <label className="toggle">
          <input type="checkbox" checked={opts.matchCase} onChange={(e) => setOpts({ ...opts, matchCase: e.target.checked })} />
          <span className="switch" />
          Match case
        </label>
        <label className="toggle">
          <input type="checkbox" checked={opts.wholeWord} onChange={(e) => setOpts({ ...opts, wholeWord: e.target.checked })} />
          <span className="switch" />
          Whole words only
        </label>
      </div>
      <div className="find-results">
        {find && !hits.length && <p className="hint">No match.</p>}
        {hits.slice(0, 200).map((h, i) => (
          <div key={i} className="find-hit">
            <small>{h.where}</small>
            <span className="before">{h.before.length > 80 ? h.before.slice(0, 80) + '…' : h.before}</span>
            <Icon name="chevron" size={12} />
            <span className="after">{h.after.length > 80 ? h.after.slice(0, 80) + '…' : h.after}</span>
          </div>
        ))}
        {hits.length > 200 && <p className="hint">…and {hits.length - 200} more</p>}
      </div>
      <div className="actions">
        <button className="btn primary" disabled={!hits.length} onClick={apply}>
          <Icon name="replace" size={15} /> Replace {hits.length ? `all ${hits.length}` : ''}
        </button>
      </div>
    </Window>
  );
}

// ── Data layers ──────────────────────────────────────────────────────────────

export function DataWindow() {
  const open = useWorld((s) => s.dataOpen);
  if (!open) return null;
  return <DataBody />;
}

function DataBody() {
  const close = () => useWorld.setState({ dataOpen: false });
  const on = useWorld((s) => s.doc?.overlays ?? []);
  const [cached, setCached] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let live = true;
    Promise.all(OVERLAYS.map(async (o) => [o.id, await isCached(o)] as const)).then((r) => live && setCached(Object.fromEntries(r)));
    return () => {
      live = false;
    };
  }, [on]);
  const toggle = (id: string) => {
    const doc = useWorld.getState().doc;
    if (!doc) return;
    const overlays = on.includes(id) ? on.filter((x) => x !== id) : [...on, id];
    // A view setting of this world, saved with it but not an undo step.
    useWorld.setState({ doc: { ...doc, overlays, meta: { ...doc.meta, modified: Date.now() } } });
  };
  return (
    <Window icon="database" title="Data layers" onClose={close}>
      <p className="hint">Real-world data from free, open sources, drawn over your map. Each layer downloads once, then works offline.</p>
      <div className="data-list">
        {OVERLAYS.map((o) => (
          <label key={o.id} className={'data-row' + (on.includes(o.id) ? ' on' : '')}>
            <input type="checkbox" checked={on.includes(o.id)} onChange={() => toggle(o.id)} />
            <span className="data-swatch" style={{ background: o.color }} />
            <span className="grow">
              <strong>{o.name}</strong>
              <small>
                {o.desc} · {o.credit}
              </small>
            </span>
            <small className="data-size">{o.live ? 'live' : cached[o.id] ? 'offline ✓' : o.size}</small>
          </label>
        ))}
      </div>
    </Window>
  );
}
