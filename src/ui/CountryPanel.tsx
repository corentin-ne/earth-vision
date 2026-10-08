import { useMemo, useRef, useState } from 'react';
import {
  useWorld,
  countryAggregates,
  updateCountry,
  setStat,
  setFlag,
  deleteCountry,
  annexCountry,
  select,
  countryBounds,
  setTool,
} from '../world/store';
import { mapCtl } from '../map/controller';
import { ColorField, CountryPicker, Flag, NumberField, Section, Stat, TextField } from './common';
import { RegionCard } from './RegionPanels';
import { CountryAlliances } from './AlliancePanel';
import { Icon } from './icons';
import { fmtArea, fmtInt } from '../util';

export function CountryPanel({ cid }: { cid: string }) {
  const doc = useWorld((s) => s.doc)!;
  const selection = useWorld((s) => s.selection);
  const c = doc.countries[cid];
  const agg = countryAggregates(doc)[cid] ?? { area: 0, regions: 0, vals: {} };
  const fileRef = useRef<HTMLInputElement>(null);
  const [showRegions, setShowRegions] = useState(false);
  const [annexing, setAnnexing] = useState(false);
  const rank = useMemo(() => {
    const all = countryAggregates(doc);
    return Object.keys(doc.countries)
      .filter((k) => all[k]?.regions)
      .sort((a, b) => all[b].area - all[a].area)
      .indexOf(cid);
  }, [doc, cid]);
  const regions = useMemo(
    () => (showRegions ? Object.values(doc.regions).filter((r) => r.cid === cid).sort((a, b) => b.area - a.area) : []),
    [doc.regions, cid, showRegions],
  );
  if (!c) return null;
  const focused = selection.regions.length === 1 ? doc.regions[selection.regions[0]] : null;
  const capital = c.capital != null ? doc.cities[c.capital] : null;

  return (
    <div className="panel-body">
      <div className="country-head">
        <div className="flag-btn">
          <button title="View the flag" onClick={() => useWorld.setState({ flagView: cid })}>
            <Flag country={c} size={44} />
          </button>
          <button className="flag-edit" title="Upload a flag" onClick={() => fileRef.current?.click()}>
            <Icon name="image" size={14} />
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setFlag(cid, f);
            e.target.value = '';
          }}
        />
        <div className="grow">
          <TextField className="title-input" value={c.name} onCommit={(name) => name.trim() && updateCountry(cid, { name: name.trim() }, 'Rename country')} />
          <div className="sub">
            <span className="badge">{c.cid}</span>
            {rank >= 0 && <span>#{rank + 1} by area</span>}
            <button className="link" onClick={() => useWorld.setState({ flagMakerFor: cid })} title="Design a flag: layout, colours, emblem">
              <Icon name="flag" size={12} /> Design flag
            </button>
            {capital && (
              <button className="link" onClick={() => mapCtl?.flyTo([capital.lng, capital.lat], 6)}>
                <Icon name="crown" size={12} /> {capital.name}
              </button>
            )}
          </div>
        </div>
      </div>

      {focused && focused.cid === cid && <RegionCard region={focused} />}

      <div className="actions">
        <button
          className="btn primary"
          onClick={() => {
            useWorld.setState({ brushCid: cid });
            setTool('paint');
          }}
          title="Paint regions into this country (B)"
        >
          <Icon name="brush" size={15} /> Paint
        </button>
        <button className="btn" onClick={() => mapCtl?.fitBounds(countryBounds(cid))}>
          <Icon name="target" size={15} /> Zoom to
        </button>
        <button className="btn" onClick={() => setAnnexing(!annexing)}>
          <Icon name="merge" size={15} /> Annex…
        </button>
      </div>
      {annexing && (
        <div className="callout">
          <p>Merge {c.name} into another country. All its regions change hands.</p>
          <CountryPicker
            value={null}
            exclude={cid}
            placeholder="Annexed by…"
            onChange={(dst) => {
              if (dst) annexCountry(cid, dst);
              setAnnexing(false);
            }}
          />
        </div>
      )}

      <div className="stats">
        <Stat label="Area">{fmtArea(agg.area)}</Stat>
        <Stat label="Regions">{fmtInt(agg.regions)}</Stat>
        {doc.settings.stats.map((s) => (
          <Stat key={s.key} label={s.key}>
            <NumberField value={s.scale ? agg.vals[s.key] ?? 0 : c.stats[s.key] ?? 0} onCommit={(v) => setStat(cid, s.key, v)} />
          </Stat>
        ))}
        {doc.settings.stats.some((s) => s.key.toLowerCase().startsWith('pop')) && agg.area > 0 && (
          <Stat label="Density">
            {(() => {
              const k = doc.settings.stats.find((s) => s.key.toLowerCase().startsWith('pop'))!;
              const pop = k.scale ? agg.vals[k.key] ?? 0 : c.stats[k.key] ?? 0;
              return `${(pop / agg.area).toFixed(1)} /km²`;
            })()}
          </Stat>
        )}
      </div>

      <Section title="Alliances">
        <CountryAlliances cid={cid} />
      </Section>

      <Section title="Colour">
        <ColorField value={c.color} onChange={(color) => updateCountry(cid, { color }, 'Recolour country')} />
      </Section>

      {doc.settings.fields.length > 0 && (
        <Section title="Details">
          <div className="fields">
            {doc.settings.fields.map((f) => (
              <label key={f}>
                <span>{f}</span>
                <TextField value={c.fields[f] ?? ''} placeholder="—" onCommit={(v) => updateCountry(cid, { fields: { ...c.fields, [f]: v } }, `Edit ${f}`)} />
              </label>
            ))}
          </div>
        </Section>
      )}

      <Section title="Notes">
        <TextField multiline value={c.notes ?? ''} placeholder="History, culture, lore…" onCommit={(notes) => updateCountry(cid, { notes }, 'Edit notes')} />
      </Section>

      <Section
        title={`Regions (${agg.regions})`}
        right={
          <button className="link" onClick={() => setShowRegions(!showRegions)}>
            {showRegions ? 'Hide' : 'Show'}
          </button>
        }
      >
        {showRegions && (
          <div className="region-list">
            {regions.map((r) => (
              <button key={r.id} className={selection.regions.includes(r.id) ? 'on' : ''} onClick={() => select({ cid, regions: [r.id] })}>
                <span className="grow">{r.name}</span>
                <small>{fmtArea(r.area)}</small>
              </button>
            ))}
          </div>
        )}
      </Section>

      <div className="danger-zone">
        <button
          className="btn ghost danger"
          onClick={() => {
            if (confirm(`Dissolve ${c.name}? Its regions become unclaimed (you can undo).`)) deleteCountry(cid);
          }}
        >
          <Icon name="trash" size={15} /> Dissolve country
        </button>
        {c.flag && (
          <button className="btn ghost" onClick={() => setFlag(cid, null)}>
            Reset flag
          </button>
        )}
      </div>
    </div>
  );
}
