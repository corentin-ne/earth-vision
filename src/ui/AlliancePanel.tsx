import { useState, type CSSProperties } from 'react';
import type { Alliance } from '../types';
import { useWorld, createAlliance, updateAlliance, deleteAlliance, setMember, select, countryBounds, boundsOf, regionsOf } from '../world/store';
import { mapCtl } from '../map/controller';
import { ColorField, CountryPicker, Flag, TextField } from './common';
import { Icon } from './icons';

const NAMES = ['Northern Pact', 'Concord of the Seas', 'Iron League', 'Sun Accord', 'Union of the Rivers', 'Triple Entente', 'Silver Compact', 'Mountain Covenant'];

/** Shows one alliance on the map (or all of them) and frames its members. */
export function viewAlliance(a: Alliance | 'all') {
  useWorld.setState({ allianceView: a === 'all' ? 'all' : a.id, worldOpen: false });
  if (a !== 'all' && a.members.length) mapCtl?.fitBounds(boundsOf(a.members.flatMap((cid) => regionsOf(cid).map((r) => r.id))), 5);
}

/** The world's alliances: found, rename, recolour, add or remove members, show on the map. */
export function AllianceSection() {
  const alliances = useWorld((s) => s.doc!.alliances);
  const view = useWorld((s) => s.allianceView);
  const [open, setOpen] = useState<string | null>(null);
  const found = () => {
    const taken = new Set(alliances.map((a) => a.name));
    const name = NAMES.find((n) => !taken.has(n)) ?? `Alliance ${alliances.length + 1}`;
    const sel = useWorld.getState().selection.cid;
    const id = createAlliance(name, sel ? [sel] : []);
    setOpen(id);
    useWorld.setState({ allianceView: id });
  };
  return (
    <div className="alliances">
      <div className="list-title-row">
        <h3 className="list-title">Alliances</h3>
        <div className="grow" />
        {alliances.length > 0 && (
          <button className={'link' + (view ? ' on' : '')} onClick={() => (view ? useWorld.setState({ allianceView: null }) : viewAlliance('all'))} title="Colour the map by alliance (U)">
            <Icon name="eye" size={13} /> {view ? 'Hide map' : 'Show on map'}
          </button>
        )}
        <button className="link" onClick={found}>
          <Icon name="plus" size={13} /> New
        </button>
      </div>
      {!alliances.length && <p className="hint">No alliance yet. Found one to group countries under a shared colour on the map.</p>}
      {alliances.map((a) => (
        <AllianceRow key={a.id} a={a} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} />
      ))}
    </div>
  );
}

function AllianceRow({ a, open, onToggle }: { a: Alliance; open: boolean; onToggle: () => void }) {
  const countries = useWorld((s) => s.doc!.countries);
  const view = useWorld((s) => s.allianceView);
  const members = a.members.filter((cid) => countries[cid]);
  return (
    <div className={'alliance' + (open ? ' open' : '') + (view === a.id ? ' viewing' : '')}>
      <div className="alliance-head">
        <button className="alliance-main" onClick={onToggle}>
          <span className="swatch-mini" style={{ background: a.color }} />
          <strong className="grow">{a.name}</strong>
          <span className="alliance-flags">
            {members.slice(0, 5).map((cid) => (
              <Flag key={cid} country={countries[cid]} size={13} />
            ))}
          </span>
          <small>{members.length}</small>
          <Icon name="chevronDown" size={14} className={'chev' + (open ? ' up' : '')} />
        </button>
        <button className={'icon-btn' + (view === a.id ? ' on' : '')} title="Show on the map" onClick={() => (view === a.id ? useWorld.setState({ allianceView: null }) : viewAlliance(a))}>
          <Icon name="eye" size={15} />
        </button>
      </div>
      {open && (
        <div className="alliance-body">
          <TextField className="alliance-name" value={a.name} onCommit={(name) => name.trim() && updateAlliance(a.id, { name: name.trim() }, 'Rename alliance')} />
          <ColorField value={a.color} onChange={(color) => updateAlliance(a.id, { color }, 'Recolour alliance')} />
          <div className="member-list">
            {members.map((cid) => (
              <div key={cid} className="member">
                <button
                  className="link grow"
                  onClick={() => {
                    select({ cid });
                    mapCtl?.fitBounds(countryBounds(cid));
                  }}
                >
                  <Flag country={countries[cid]} size={14} /> {countries[cid].name}
                </button>
                <button className="icon-btn" title={`Remove ${countries[cid].name}`} onClick={() => setMember(a.id, cid, false)}>
                  <Icon name="x" size={13} />
                </button>
              </div>
            ))}
          </div>
          <CountryPicker value={null} placeholder="Add a member…" onChange={(cid) => cid && setMember(a.id, cid, true)} />
          <div className="actions">
            <button
              className="btn ghost danger"
              onClick={() => {
                if (confirm(`Disband ${a.name}? (You can undo.)`)) deleteAlliance(a.id);
              }}
            >
              <Icon name="trash" size={15} /> Disband
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** On a country's page: the alliances it is in, and joining another. */
export function CountryAlliances({ cid }: { cid: string }) {
  const alliances = useWorld((s) => s.doc!.alliances);
  const name = useWorld((s) => s.doc!.countries[cid]?.name ?? '');
  const mine = alliances.filter((a) => a.members.includes(cid));
  const others = alliances.filter((a) => !a.members.includes(cid));
  return (
    <div className="country-alliances">
      {mine.map((a) => (
        <span key={a.id} className="chip" style={{ '--chip': a.color } as CSSProperties}>
          <button className="chip-main" onClick={() => viewAlliance(a)} title="Show on the map">
            <span className="swatch-mini" style={{ background: a.color }} />
            {a.name}
          </button>
          <button className="chip-x" title={`${name} leaves ${a.name}`} onClick={() => setMember(a.id, cid, false)}>
            <Icon name="x" size={11} />
          </button>
        </span>
      ))}
      {others.length > 0 && (
        <select
          className="chip-add"
          value=""
          onChange={(e) => {
            if (e.target.value) setMember(e.target.value, cid, true);
          }}
        >
          <option value="">{mine.length ? 'Join another…' : 'Join an alliance…'}</option>
          {others.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      <button
        className="link"
        onClick={() => {
          const id = createAlliance(`${name} Pact`, [cid]);
          useWorld.setState({ allianceView: id });
        }}
      >
        <Icon name="plus" size={12} /> Found one
      </button>
    </div>
  );
}

/** Legend while the map is coloured by alliance. */
export function AllianceLegend() {
  const view = useWorld((s) => s.allianceView);
  const alliances = useWorld((s) => s.doc?.alliances ?? []);
  const countries = useWorld((s) => s.doc?.countries ?? {});
  if (!view) return null;
  const shown = view === 'all' ? alliances : alliances.filter((a) => a.id === view);
  return (
    <div className="alliance-legend glass">
      <div className="legend-head">
        <Icon name="shield" size={15} />
        <strong className="grow">{view === 'all' ? 'Alliances' : shown[0]?.name ?? 'Alliance'}</strong>
        {view !== 'all' && alliances.length > 1 && (
          <button className="link" onClick={() => viewAlliance('all')}>
            All
          </button>
        )}
        <button className="icon-btn" title="Back to countries (U)" onClick={() => useWorld.setState({ allianceView: null })}>
          <Icon name="x" size={14} />
        </button>
      </div>
      {!alliances.length && <p className="hint">No alliance yet: found one from the world panel or a country's page.</p>}
      {shown.map((a) => (
        <button key={a.id} className="legend-row" onClick={() => viewAlliance(a)}>
          <span className="swatch-mini" style={{ background: a.color }} />
          <span className="grow">{a.name}</span>
          <small>{a.members.filter((m) => countries[m]).length}</small>
        </button>
      ))}
    </div>
  );
}
