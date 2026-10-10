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
import { CountryPicker, Flag, NumberField, Section, Stat, TextField } from './common';
import { CountryAlliances } from './AlliancePanel';
import { startSnap } from './SnapCard';
import { LoreField, Backlinks } from './Lore';
import { CountryColour } from './CountryColour';
import { CountryOccupations, CountryRealm, CountryStates, LabelControl } from './WorldbuildPanels';
import { Icon, type IconName } from './icons';
import { fmtArea, fmtInt } from '../util';

type Tab = 'overview' | 'look' | 'politics' | 'lore';
const TABS: [Tab, IconName, string][] = [
  ['overview', 'list', 'Overview'],
  ['look', 'palette', 'Look'],
  ['politics', 'shield', 'Politics'],
  ['lore', 'book', 'Lore'],
];
/** The tab stays the same from one country to the next. */
let lastTab: Tab = 'overview';

/** A country's page, in four tabs: figures and regions, how it looks, its ties to others, its story. */
export function CountryPanel({ cid }: { cid: string }) {
  const doc = useWorld((s) => s.doc)!;
  const selection = useWorld((s) => s.selection);
  const c = doc.countries[cid];
  const agg = countryAggregates(doc)[cid] ?? { area: 0, regions: 0, vals: {} };
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTabState] = useState<Tab>(lastTab);
  const setTab = (t: Tab) => {
    lastTab = t;
    setTabState(t);
  };
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
  const capital = c.capital != null ? doc.cities[c.capital] : null;
  const pop = doc.settings.stats.find((s) => s.key.toLowerCase().startsWith('pop'));

  return (
    <div className="panel-body">
      <div className="country-head">
        <div className="flag-btn">
          <button title="View the flag" onClick={() => useWorld.setState({ flagView: cid })}>
            <Flag country={c} size={44} />
          </button>
        </div>
        <div className="grow">
          <TextField className="title-input" value={c.name} onCommit={(name) => name.trim() && updateCountry(cid, { name: name.trim() }, 'Rename country')} />
          <div className="sub">
            <span className="badge">{c.cid}</span>
            {rank >= 0 && <span>#{rank + 1} by area</span>}
            {capital && (
              <button className="link" onClick={() => mapCtl?.flyTo([capital.lng, capital.lat], 6)}>
                <Icon name="crown" size={12} /> {capital.name}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(([t, icon, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            <Icon name={icon} size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
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
          </div>

          <div className="stats">
            <Stat label="Area">{fmtArea(agg.area)}</Stat>
            <Stat label="Regions">{fmtInt(agg.regions)}</Stat>
            {doc.settings.stats.map((s) => (
              <Stat key={s.key} label={s.key}>
                <NumberField value={s.scale ? agg.vals[s.key] ?? 0 : c.stats[s.key] ?? 0} onCommit={(v) => setStat(cid, s.key, v)} />
              </Stat>
            ))}
            {pop && agg.area > 0 && <Stat label="Density">{`${((pop.scale ? agg.vals[pop.key] ?? 0 : c.stats[pop.key] ?? 0) / agg.area).toFixed(1)} /km²`}</Stat>}
          </div>

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
        </>
      )}

      {tab === 'look' && (
        <>
          <Section title="Colour">
            <CountryColour cid={cid} />
          </Section>
          <Section title="Flag">
            <div className="actions">
              <button className="btn" onClick={() => useWorld.setState({ flagMakerFor: cid })} title="Design a flag: layout, colours, emblem">
                <Icon name="flag" size={15} /> Design
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                <Icon name="image" size={15} /> Upload
              </button>
              {c.flag && (
                <button className="btn ghost" onClick={() => setFlag(cid, null)}>
                  Reset
                </button>
              )}
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
          </Section>
          <Section title="Name on the map">
            <LabelControl cid={cid} />
          </Section>
        </>
      )}

      {tab === 'politics' && (
        <>
          <Section title="Alliances">
            <CountryAlliances cid={cid} />
          </Section>
          <Section title="Realm">
            <CountryRealm cid={cid} />
          </Section>
          <Section title={`States (${Object.keys(c.states ?? {}).length})`}>
            <CountryStates cid={cid} />
          </Section>
          <Section title="Occupation">
            <CountryOccupations cid={cid} />
          </Section>
          <Section title="Borders">
            <div className="actions">
              <button className="btn" onClick={() => startSnap(cid)} title="Move a border onto the rivers and mountain crests near it">
                <Icon name="river" size={15} /> Snap a border to rivers…
              </button>
              <button className="btn" onClick={() => setAnnexing(!annexing)}>
                <Icon name="merge" size={15} /> Annexed by…
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
          </div>
        </>
      )}

      {tab === 'lore' && (
        <Section title="Lore">
          <LoreField value={c.notes ?? ''} onCommit={(notes) => updateCountry(cid, { notes }, 'Edit lore')} />
          <Backlinks name={c.name} />
        </Section>
      )}
    </div>
  );
}
