import { useState } from 'react';
import type { Region } from '../types';
import {
  useWorld,
  updateRegion,
  transferRegions,
  createCountry,
  mergeRegions,
  select,
  setTool,
  boundsOf,
  updateCity,
  deleteCity,
  makeCapital,
  regionAt,
  toast,
} from '../world/store';
import { mapCtl } from '../map/controller';
import { CountryPicker, Flag, NumberField, Stat, TextField } from './common';
import { Icon } from './icons';
import { fmtArea, fmtCompact } from '../util';

function NewCountryForm({ ids, onDone }: { ids: number[]; onDone: () => void }) {
  const [name, setName] = useState('');
  const go = () => {
    const n = name.trim();
    if (!n) return;
    const cid = createCountry(n, ids);
    select({ cid });
    useWorld.setState({ brushCid: cid });
    toast(`${n} is born`, 'ok');
    onDone();
  };
  return (
    <div className="callout row">
      <input
        autoFocus
        placeholder="Name of the new country"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') go();
          if (e.key === 'Escape') onDone();
        }}
      />
      <button className="btn primary" onClick={go} disabled={!name.trim()}>
        Create
      </button>
    </div>
  );
}

/** The focused region, shown inside the country page (or alone when unclaimed). */
export function RegionCard({ region: r }: { region: Region }) {
  const allStats = useWorld((s) => s.doc!.settings.stats);
  const stats = allStats.filter((x) => x.scale);
  const [creating, setCreating] = useState(false);
  return (
    <div className="region-card">
      <div className="region-card-head">
        <Icon name="flat" size={15} />
        <TextField className="region-name" value={r.name} onCommit={(name) => name.trim() && updateRegion(r.id, { name: name.trim() }, 'Rename region')} />
        <button className="icon-btn" title="Back to the country" onClick={() => select({ cid: r.cid || null })}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="stats compact">
        <Stat label="Area">{fmtArea(r.area)}</Stat>
        {stats.map((s) => (
          <Stat key={s.key} label={s.key}>
            <NumberField value={r.vals?.[s.key] ?? 0} onCommit={(v) => updateRegion(r.id, { vals: { ...r.vals, [s.key]: v } }, `Set ${s.key}`)} />
          </Stat>
        ))}
      </div>
      <label className="field-row">
        <span>Belongs to</span>
        <CountryPicker
          value={r.cid}
          allowNone
          onChange={(cid) => {
            transferRegions([r.id], cid);
            select({ cid: cid || null, regions: [r.id] });
          }}
        />
      </label>
      <div className="actions">
        <button className="btn" onClick={() => setCreating(!creating)}>
          <Icon name="flag" size={15} /> New country here
        </button>
        <button
          className="btn"
          title="Draw a line across the region (K)"
          onClick={() => {
            select({ cid: r.cid || null, regions: [r.id] });
            setTool('split');
          }}
        >
          <Icon name="knife" size={15} /> Split
        </button>
      </div>
      {creating && <NewCountryForm ids={[r.id]} onDone={() => setCreating(false)} />}
    </div>
  );
}

export function MultiRegionPanel({ ids }: { ids: number[] }) {
  const doc = useWorld((s) => s.doc)!;
  const [creating, setCreating] = useState(false);
  const regions = ids.map((id) => doc.regions[id]).filter(Boolean);
  const area = regions.reduce((s, r) => s + r.area, 0);
  const owners = [...new Set(regions.map((r) => r.cid))];
  const scaled = doc.settings.stats.filter((s) => s.scale);
  return (
    <div className="panel-body">
      <div className="panel-title">
        <h2>{regions.length} regions selected</h2>
        <button className="icon-btn" onClick={() => select({})} title="Clear selection (Esc)">
          <Icon name="x" />
        </button>
      </div>
      <p className="hint">Shift-click regions on the map to add or remove them.</p>
      <div className="stats">
        <Stat label="Area">{fmtArea(area)}</Stat>
        {scaled.map((s) => (
          <Stat key={s.key} label={s.key}>
            {fmtCompact(regions.reduce((t, r) => t + (r.vals?.[s.key] ?? 0), 0))}
          </Stat>
        ))}
        <Stat label="Owners">
          <span className="owners">
            {owners.slice(0, 6).map((cid) => (
              <Flag key={cid} country={doc.countries[cid]} size={14} />
            ))}
            {owners.length > 6 && `+${owners.length - 6}`}
          </span>
        </Stat>
      </div>
      <label className="field-row">
        <span>Give all to</span>
        <CountryPicker
          value={owners.length === 1 ? owners[0] : null}
          allowNone
          onChange={(cid) => {
            transferRegions(ids, cid);
            select({ cid: cid || null, regions: ids });
          }}
        />
      </label>
      <div className="actions">
        <button className="btn primary" onClick={() => setCreating(!creating)}>
          <Icon name="flag" size={15} /> New country
        </button>
        <button className="btn" onClick={() => mergeRegions(ids)} title="Fuse the selected regions into a single region">
          <Icon name="merge" size={15} /> Merge into one
        </button>
        <button className="btn" onClick={() => mapCtl?.fitBounds(boundsOf(ids))}>
          <Icon name="target" size={15} /> Zoom
        </button>
      </div>
      {creating && <NewCountryForm ids={ids} onDone={() => setCreating(false)} />}
      <div className="region-list">
        {regions.map((r) => (
          <button key={r.id} onClick={() => select({ cid: r.cid || null, regions: [r.id] })}>
            <Flag country={doc.countries[r.cid]} size={12} />
            <span className="grow">{r.name}</span>
            <small>{fmtArea(r.area)}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

export function CityPanel({ id }: { id: number }) {
  const doc = useWorld((s) => s.doc)!;
  const city = doc.cities[id];
  if (!city) return null;
  const owner = regionAt([city.lng, city.lat]);
  const country = owner ? doc.countries[owner.cid] : undefined;
  const isCapital = country?.capital === id;
  return (
    <div className="panel-body">
      <div className="panel-title">
        <Icon name={city.capital ? 'crown' : 'city'} />
        <TextField className="title-input" value={city.name} onCommit={(name) => name.trim() && updateCity(id, { name: name.trim() }, 'Rename city')} autoFocus={city.name === 'New city'} />
        <button className="icon-btn" onClick={() => select({})}>
          <Icon name="x" />
        </button>
      </div>
      <div className="stats">
        <Stat label="Country">
          {country ? (
            <button className="link" onClick={() => select({ cid: country.cid })}>
              <Flag country={country} size={12} /> {country.name}
            </button>
          ) : (
            'Unclaimed'
          )}
        </Stat>
        <Stat label="Region">{owner?.name ?? '—'}</Stat>
        <Stat label="Population">
          <NumberField value={city.pop ?? 0} onCommit={(pop) => updateCity(id, { pop }, 'Set city population')} />
        </Stat>
        <Stat label="Position">
          {city.lat.toFixed(2)}°, {city.lng.toFixed(2)}°
        </Stat>
      </div>
      <div className="actions">
        <button className={'btn' + (isCapital ? ' primary' : '')} disabled={!country || isCapital} onClick={() => makeCapital(id)}>
          <Icon name="crown" size={15} /> {isCapital ? 'Capital' : 'Make capital'}
        </button>
        {!isCapital && city.capital && (
          <button className="btn" onClick={() => updateCity(id, { capital: false }, 'Demote city')}>
            Not a capital
          </button>
        )}
        <button className="btn" onClick={() => updateCity(id, { hidden: !city.hidden }, city.hidden ? 'Show city' : 'Hide city')}>
          <Icon name="eye" size={15} /> {city.hidden ? 'Show' : 'Hide'}
        </button>
        <button className="btn" onClick={() => mapCtl?.flyTo([city.lng, city.lat], 7)}>
          <Icon name="target" size={15} />
        </button>
        <button className="btn ghost danger" onClick={() => deleteCity(id)}>
          <Icon name="trash" size={15} />
        </button>
      </div>
      <p className="hint">With the City tool (C) you can drag cities around and click the map to add new ones.</p>
    </div>
  );
}
