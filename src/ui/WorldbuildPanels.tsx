import { useState } from 'react';
import type { LabelKind, LineKind, Mark, Region } from '../types';
import { useWorld, select, boundsOf, regionsOf, updateRegion, type DrawKind } from '../world/store';
import {
  setOccupation,
  occupationsOf,
  createState,
  updateState,
  deleteState,
  assignState,
  stateColor,
  setOverlord,
  vassalsOf,
  deleteRegions,
  updateMark,
  deleteMark,
  resetLabel,
  LINE_KINDS,
  LABEL_KINDS,
} from '../world/edits';
import { mapCtl } from '../map/controller';
import { PINS } from '../map/pins';
import { ColorField, CountryPicker, Flag, Section, TextField } from './common';
import { LoreField, Backlinks } from './Lore';
import { Icon, type IconName } from './icons';
import { fmtArea } from '../util';

// ── Region ───────────────────────────────────────────────────────────────────

/** State, occupation, lore and sinking of one region (under its card). */
export function RegionExtras({ region: r }: { region: Region }) {
  const owner = useWorld((s) => s.doc!.countries[r.cid]);
  const states = Object.entries(owner?.states ?? {});
  const [naming, setNaming] = useState(false);
  return (
    <div className="region-extras">
      {owner && (
        <label className="field-row">
          <span>State</span>
          {naming ? (
            <NameInput
              placeholder="Name of the new state"
              onDone={(name) => {
                setNaming(false);
                if (name) createState(owner.cid, name, [r.id]);
              }}
            />
          ) : (
            <select
              value={r.state ?? ''}
              onChange={(e) => (e.target.value === '+' ? setNaming(true) : assignState([r.id], e.target.value || null))}
            >
              <option value="">None</option>
              {states.map(([k, st]) => (
                <option key={k} value={k}>
                  {st.name}
                </option>
              ))}
              <option value="+">New state…</option>
            </select>
          )}
        </label>
      )}
      {owner && (
        <label className="field-row">
          <span>Occupied by</span>
          <CountryPicker value={r.occ ?? ''} allowNone noneLabel="Nobody" exclude={r.cid} onChange={(cid) => setOccupation([r.id], cid || null)} />
        </label>
      )}
      <Section title="Lore">
        <LoreField value={r.notes ?? ''} placeholder="What happened here…" onCommit={(notes) => updateRegion(r.id, { notes: notes || undefined }, 'Edit lore')} />
        <Backlinks name={r.name} />
      </Section>
      <div className="danger-zone">
        <button
          className="btn ghost danger"
          onClick={() => {
            if (confirm(`Sink ${r.name} into the sea? (you can undo)`)) deleteRegions([r.id]);
          }}
        >
          <Icon name="trash" size={15} /> Sink this region
        </button>
      </div>
    </div>
  );
}

/** Occupy, put in a state, or sink several regions at once. */
export function MultiExtras({ ids }: { ids: number[] }) {
  const doc = useWorld((s) => s.doc)!;
  const owners = [...new Set(ids.map((id) => doc.regions[id]?.cid).filter(Boolean))];
  const one = owners.length === 1 ? doc.countries[owners[0]] : undefined;
  const [naming, setNaming] = useState(false);
  return (
    <div className="region-extras">
      <label className="field-row">
        <span>Occupy by</span>
        <CountryPicker value={null} allowNone noneLabel="Nobody (end occupation)" placeholder="Occupier…" onChange={(cid) => setOccupation(ids, cid || null)} />
      </label>
      {one && (
        <label className="field-row">
          <span>State</span>
          {naming ? (
            <NameInput
              placeholder="Name of the new state"
              onDone={(name) => {
                setNaming(false);
                if (name) createState(one.cid, name, ids);
              }}
            />
          ) : (
            <select value="" onChange={(e) => (e.target.value === '+' ? setNaming(true) : e.target.value && assignState(ids, e.target.value === '-' ? null : e.target.value))}>
              <option value="">Put in a state…</option>
              {Object.entries(one.states ?? {}).map(([k, st]) => (
                <option key={k} value={k}>
                  {st.name}
                </option>
              ))}
              <option value="-">No state</option>
              <option value="+">New state from these…</option>
            </select>
          )}
        </label>
      )}
      <div className="danger-zone">
        <button
          className="btn ghost danger"
          onClick={() => {
            if (confirm(`Sink ${ids.length} regions into the sea? (you can undo)`)) deleteRegions(ids);
          }}
        >
          <Icon name="trash" size={15} /> Sink these regions
        </button>
      </div>
    </div>
  );
}

function NameInput({ placeholder, onDone }: { placeholder: string; onDone: (name: string | null) => void }) {
  const [v, setV] = useState('');
  return (
    <input
      autoFocus
      placeholder={placeholder}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v.trim() || null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') onDone(v.trim() || null);
        if (e.key === 'Escape') onDone(null);
      }}
    />
  );
}

// ── Country: realm, states, occupations ─────────────────────────────────────

export function CountryRealm({ cid }: { cid: string }) {
  const doc = useWorld((s) => s.doc)!;
  const c = doc.countries[cid];
  const vassals = vassalsOf(cid);
  const lord = c.overlord ? doc.countries[c.overlord] : undefined;
  const [adding, setAdding] = useState(false);
  return (
    <div className="realm">
      <label className="field-row">
        <span>Overlord</span>
        <CountryPicker value={c.overlord ?? ''} allowNone noneLabel="None (sovereign)" exclude={cid} onChange={(o) => setOverlord(cid, o || null)} />
      </label>
      {lord && <p className="hint">{c.name} is a vassal of {lord.name}. With “Realms” in Colour the map by, it is drawn in its overlord’s colours.</p>}
      {vassals.length > 0 && (
        <div className="chip-list">
          {vassals.map((v) => (
            <span key={v.cid} className="chip">
              <button className="chip-main" onClick={() => select({ cid: v.cid })}>
                <Flag country={v} size={12} /> {v.name}
              </button>
              <button className="chip-x" title={`Free ${v.name}`} onClick={() => setOverlord(v.cid, null)}>
                <Icon name="x" size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {adding ? (
        <CountryPicker
          value={null}
          exclude={cid}
          placeholder="Make a vassal of…"
          onChange={(v) => {
            setAdding(false);
            if (v) setOverlord(v, cid);
          }}
        />
      ) : (
        <button className="btn small" onClick={() => setAdding(true)}>
          <Icon name="crownSmall" size={14} /> Add a vassal
        </button>
      )}
    </div>
  );
}

export function CountryStates({ cid }: { cid: string }) {
  const doc = useWorld((s) => s.doc)!;
  const sel = useWorld((s) => s.selection);
  const c = doc.countries[cid];
  const [naming, setNaming] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const counts: Record<string, { n: number; area: number }> = {};
  for (const r of Object.values(doc.regions))
    if (r.cid === cid && r.state) {
      const x = (counts[r.state] ??= { n: 0, area: 0 });
      x.n++;
      x.area += r.area;
    }
  const picked = sel.regions.filter((id) => doc.regions[id]?.cid === cid);
  const states = Object.entries(c.states ?? {});
  return (
    <div className="states">
      {!states.length && <p className="hint">Group regions into states, provinces or duchies. Their borders show as dashed lines.</p>}
      {states.map(([k, st]) => (
        <div key={k} className="state-row-wrap">
          <div className="state-row">
            <span className="swatch-mini" style={{ background: stateColor(c, k) }} />
            <TextField className="grow" value={st.name} onCommit={(name) => name.trim() && updateState(cid, k, { name: name.trim() })} />
            <small>{counts[k]?.n ?? 0} reg.</small>
            <button className="icon-btn" title="Select its regions" onClick={() => selectState(cid, k)}>
              <Icon name="target" size={14} />
            </button>
            <button className={'icon-btn' + (open === k ? ' on' : '')} title="Colour" onClick={() => setOpen(open === k ? null : k)}>
              <Icon name="palette" size={14} />
            </button>
            <button className="icon-btn" title={`Dissolve ${st.name}`} onClick={() => deleteState(cid, k)}>
              <Icon name="trash" size={14} />
            </button>
          </div>
          {open === k && <ColorField value={st.color ?? stateColor(c, k)} onChange={(color) => updateState(cid, k, { color })} />}
          {counts[k] && <small className="state-area">{fmtArea(counts[k].area)}</small>}
        </div>
      ))}
      {naming ? (
        <NameInput
          placeholder={picked.length ? `Name of the state (${picked.length} region${picked.length > 1 ? 's' : ''})` : 'Name of the new state'}
          onDone={(name) => {
            setNaming(false);
            if (name) createState(cid, name, picked);
          }}
        />
      ) : (
        <button className="btn small" onClick={() => setNaming(true)} title="Shift-click regions first to put them in the new state">
          <Icon name="plus" size={14} /> New state{picked.length > 1 ? ` from ${picked.length} selected regions` : ''}
        </button>
      )}
    </div>
  );
}

function selectState(cid: string, key: string) {
  const ids = regionsOf(cid)
    .filter((r) => r.state === key)
    .map((r) => r.id);
  if (!ids.length) return;
  select({ cid, regions: ids });
  mapCtl?.fitBounds(boundsOf(ids), 7, { keepDetails: true });
}

export function CountryOccupations({ cid }: { cid: string }) {
  const doc = useWorld((s) => s.doc)!;
  const { holds, lost } = occupationsOf(cid);
  if (!holds.length && !lost.length) return <p className="hint">No occupation. Pick “Occupied by” on a region to show contested land as stripes.</p>;
  const by = (rs: Region[], key: 'cid' | 'occ') => {
    const m: Record<string, Region[]> = {};
    for (const r of rs) (m[r[key]!] ??= []).push(r);
    return Object.entries(m);
  };
  return (
    <div className="occupations">
      {by(holds, 'cid').map(([owner, rs]) => (
        <div key={'h' + owner} className="occ-row">
          <Icon name="stripes" size={14} />
          <span className="grow">
            Holds {rs.length} region{rs.length > 1 ? 's' : ''} of {doc.countries[owner]?.name ?? 'unclaimed land'}
          </span>
          <button className="link" onClick={() => setOccupation(rs.map((r) => r.id), null)}>
            Withdraw
          </button>
        </div>
      ))}
      {by(lost, 'occ').map(([occ, rs]) => (
        <div key={'l' + occ} className="occ-row">
          <Icon name="stripes" size={14} />
          <span className="grow">
            {rs.length} region{rs.length > 1 ? 's' : ''} held by {doc.countries[occ]?.name ?? occ}
          </span>
          <button className="link" onClick={() => setOccupation(rs.map((r) => r.id), null)}>
            Liberate
          </button>
        </div>
      ))}
    </div>
  );
}

export function LabelControl({ cid }: { cid: string }) {
  const fixed = useWorld((s) => !!s.doc!.countries[cid]?.labelFixed);
  if (!fixed) return <p className="hint">Drag the country’s name on the map to place it by hand.</p>;
  return (
    <p className="hint">
      Name placed by hand.{' '}
      <button className="link" onClick={() => resetLabel(cid)}>
        Place it automatically
      </button>
    </p>
  );
}

// ── Marks ────────────────────────────────────────────────────────────────────

export function MarkPanel({ id }: { id: string }) {
  const m = useWorld((s) => s.doc?.marks?.[id]);
  if (!m) return null;
  return (
    <div className="panel-body">
      {m.type === 'line' && <LineEditor m={m} />}
      {m.type === 'label' && <LabelEditor m={m} />}
      {m.type === 'pin' && <PinEditor m={m} />}
      <div className="actions">
        <button className="btn" onClick={() => focusMark(m)}>
          <Icon name="target" size={15} /> Zoom to
        </button>
        <button className="btn ghost danger" onClick={() => deleteMark(m.id)}>
          <Icon name="trash" size={15} /> Delete
        </button>
      </div>
    </div>
  );
}

function focusMark(m: Mark) {
  if (m.type === 'line') {
    const xs = m.coords.map((p) => p[0]);
    const ys = m.coords.map((p) => p[1]);
    mapCtl?.fitBounds([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], 7, { keepDetails: true });
  } else mapCtl?.flyTo([m.lng, m.lat], 5);
}

function LineEditor({ m }: { m: Extract<Mark, { type: 'line' }> }) {
  let len = 0;
  for (let i = 1; i < m.coords.length; i++) len += haversine(m.coords[i - 1], m.coords[i]);
  return (
    <>
      <TextField className="title-input" value={m.name} placeholder={`Name of the ${LINE_KINDS[m.kind].noun}`} onCommit={(name) => updateMark(m.id, { name }, 'Rename')} autoFocus={!m.name} />
      <div className="segmented wrap">
        {(Object.keys(LINE_KINDS) as LineKind[]).map((k) => (
          <button key={k} className={m.kind === k ? 'on' : ''} onClick={() => updateMark(m.id, { kind: k, color: m.color === LINE_KINDS[m.kind].color ? LINE_KINDS[k].color : m.color }, 'Change')}>
            {LINE_KINDS[k].label}
          </button>
        ))}
      </div>
      <p className="hint">{Math.round(len).toLocaleString('en-US')} km long · {m.coords.length} points</p>
      <Section title="Colour">
        <ColorField value={m.color} onChange={(color) => updateMark(m.id, { color }, 'Recolour')} />
      </Section>
    </>
  );
}

function LabelEditor({ m }: { m: Extract<Mark, { type: 'label' }> }) {
  return (
    <>
      <TextField className="title-input" value={m.text} onCommit={(text) => text.trim() && updateMark(m.id, { text: text.trim() }, 'Rename')} autoFocus={m.text === 'New name'} />
      <div className="segmented wrap">
        {(Object.keys(LABEL_KINDS) as LabelKind[]).map((k) => (
          <button key={k} className={m.kind === k ? 'on' : ''} onClick={() => updateMark(m.id, { kind: k, size: LABEL_KINDS[k].size }, 'Restyle')}>
            {LABEL_KINDS[k].label}
          </button>
        ))}
      </div>
      <label className="range-row">
        <span>Size</span>
        <input type="range" min={8} max={40} value={m.size} onChange={(e) => updateMark(m.id, { size: +e.target.value }, 'Resize')} />
        <strong>{m.size}</strong>
      </label>
      <label className="range-row">
        <span>Angle</span>
        <input type="range" min={-90} max={90} value={m.angle} onChange={(e) => updateMark(m.id, { angle: +e.target.value }, 'Turn')} />
        <strong>{m.angle}°</strong>
      </label>
      <p className="hint">Drag the name on the map to move it.</p>
      <Section title="Colour">
        <ColorField value={m.color ?? '#3A3346'} onChange={(color) => updateMark(m.id, { color }, 'Recolour')} />
      </Section>
    </>
  );
}

function PinEditor({ m }: { m: Extract<Mark, { type: 'pin' }> }) {
  return (
    <>
      <TextField className="title-input" value={m.name} onCommit={(name) => name.trim() && updateMark(m.id, { name: name.trim() }, 'Rename')} autoFocus={m.name === 'New place'} />
      <div className="pin-grid">
        {Object.entries(PINS).map(([k, p]) => (
          <button key={k} className={'pin-choice' + (m.icon === k ? ' on' : '')} onClick={() => updateMark(m.id, { icon: k, color: undefined }, 'Change')} title={p.label}>
            <span style={{ background: p.color }}>{p.glyph}</span>
            <small>{p.label}</small>
          </button>
        ))}
      </div>
      <Section title="Story">
        <LoreField value={m.notes ?? ''} placeholder="What happened here… (use [[Name]] to link)" onCommit={(notes) => updateMark(m.id, { notes: notes || undefined }, 'Edit story of')} />
        <Backlinks name={m.name} />
      </Section>
      <p className="hint">Drag the pin on the map to move it.</p>
    </>
  );
}

function haversine(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r;
  const dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// ── Draw tool ────────────────────────────────────────────────────────────────

export const DRAW_KINDS: { id: DrawKind; icon: IconName; label: string; hint: string }[] = [
  { id: 'land', icon: 'island', label: 'New land', hint: 'Click around the new land over the sea, double-click (or Enter) to raise it' },
  { id: 'road', icon: 'route', label: 'Road', hint: 'Click along the road, double-click (or Enter) to finish' },
  { id: 'rail', icon: 'route', label: 'Railway', hint: 'Click along the railway, double-click (or Enter) to finish' },
  { id: 'route', icon: 'route', label: 'Trade route', hint: 'Click along the route, double-click (or Enter) to finish' },
  { id: 'sea', icon: 'river', label: 'Sea lane', hint: 'Click along the sea lane, double-click (or Enter) to finish' },
  { id: 'front', icon: 'stripes', label: 'Front line', hint: 'Click along the front, double-click (or Enter) to finish' },
  { id: 'border', icon: 'flag', label: 'Claimed border', hint: 'Click along the claim, double-click (or Enter) to finish' },
  { id: 'label', icon: 'text', label: 'Name', hint: 'Click where the name goes: a sea, a mountain range, a region…' },
  { id: 'pin', icon: 'pin', label: 'Pin', hint: 'Click to pin a battle, a treaty, ruins, a temple…' },
];

export function DrawOptions({ compact }: { compact?: boolean }) {
  const kind = useWorld((s) => s.drawKind);
  const landCid = useWorld((s) => s.landCid);
  const cur = DRAW_KINDS.find((k) => k.id === kind)!;
  return (
    <div className={'draw-opts' + (compact ? ' compact' : '')}>
      <div className="draw-kinds">
        {DRAW_KINDS.map((k) => (
          <button key={k.id} className={kind === k.id ? 'on' : ''} onClick={() => useWorld.setState({ drawKind: k.id })} title={k.label}>
            <Icon name={k.icon} size={15} />
            {!compact && <span>{k.label}</span>}
          </button>
        ))}
      </div>
      {kind === 'land' && (
        <div className="brush-row">
          <span>For</span>
          <CountryPicker value={landCid} allowNone noneLabel="Nobody (unclaimed)" onChange={(cid) => useWorld.setState({ landCid: cid })} />
        </div>
      )}
      <p className="hint">
        {compact ? cur.label + ' · ' : ''}
        {compact ? cur.hint.replace(/^Click/, 'Tap').replace(/, double-click \(or Enter\) to (\w+)/, ', then Done') : cur.hint}
        {kind !== 'label' && kind !== 'pin' && !compact && ' · Backspace removes a point · Esc cancels'}
      </p>
    </div>
  );
}
