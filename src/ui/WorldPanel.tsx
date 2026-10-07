import { useMemo, useState } from 'react';
import { useWorld, countryAggregates, select, createCountry, setTool, countryBounds, toast } from '../world/store';
import { mapCtl } from '../map/controller';
import { Flag, Stat } from './common';
import { Icon } from './icons';
import { fmtArea, fmtCompact, fmtInt } from '../util';

type SortKey = 'area' | 'pop' | 'name' | 'regions';

export function WorldPanel() {
  const doc = useWorld((s) => s.doc)!;
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('area');
  const [newName, setNewName] = useState<string | null>(null);
  const agg = countryAggregates(doc);
  const popKey = doc.settings.stats.find((s) => s.scale)?.key;

  const totals = useMemo(() => {
    let land = 0;
    let claimed = 0;
    let pop = 0;
    for (const r of Object.values(doc.regions)) {
      land += r.area;
      if (r.cid) claimed += r.area;
      if (popKey) pop += r.vals?.[popKey] ?? 0;
    }
    return { land, claimed, pop };
  }, [doc.regions, popKey]);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const list = Object.values(doc.countries).filter((c) => !ql || c.name.toLowerCase().includes(ql) || c.cid.toLowerCase().includes(ql));
    const v = (cid: string, k: SortKey) =>
      k === 'area' ? agg[cid]?.area ?? 0 : k === 'pop' ? (popKey ? agg[cid]?.vals[popKey] ?? 0 : 0) : k === 'regions' ? agg[cid]?.regions ?? 0 : 0;
    return list.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : v(b.cid, sort) - v(a.cid, sort)));
  }, [doc.countries, agg, q, sort, popKey]);

  const create = () => {
    const n = newName?.trim();
    if (!n) return;
    const cid = createCountry(n);
    setNewName(null);
    select({ cid });
    useWorld.setState({ brushCid: cid });
    setTool('paint');
    toast(`Paint regions to give them to ${n}`, 'ok');
  };

  return (
    <div className="panel-body">
      <div className="stats">
        <Stat label="Countries">{fmtInt(Object.keys(doc.countries).length)}</Stat>
        <Stat label="Regions">{fmtInt(Object.keys(doc.regions).length)}</Stat>
        <Stat label="Land">{fmtArea(totals.land)}</Stat>
        <Stat label="Claimed">{totals.land ? Math.round((totals.claimed / totals.land) * 100) : 0}%</Stat>
        {popKey && <Stat label={popKey}>{fmtCompact(totals.pop)}</Stat>}
        <Stat label="Cities">{fmtInt(Object.keys(doc.cities).length)}</Stat>
      </div>

      {newName === null ? (
        <button className="btn primary wide" onClick={() => setNewName('')}>
          <Icon name="plus" size={15} /> New country
        </button>
      ) : (
        <div className="callout row">
          <input
            autoFocus
            placeholder="Name of the new country"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') create();
              if (e.key === 'Escape') setNewName(null);
            }}
          />
          <button className="btn primary" onClick={create} disabled={!newName.trim()}>
            Create
          </button>
        </div>
      )}

      <div className="list-tools">
        <div className="search-mini">
          <Icon name="search" size={14} />
          <input placeholder="Filter countries" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="area">By area</option>
          {popKey && <option value="pop">By {popKey.toLowerCase()}</option>}
          <option value="regions">By regions</option>
          <option value="name">By name</option>
        </select>
      </div>

      <div className="country-list">
        {rows.map((c, i) => {
          const a = agg[c.cid];
          return (
            <button
              key={c.cid}
              onClick={() => {
                select({ cid: c.cid });
                mapCtl?.fitBounds(countryBounds(c.cid));
              }}
            >
              <span className="rank">{sort === 'name' ? '' : i + 1}</span>
              <Flag country={c} size={16} />
              <span className="grow name">{c.name}</span>
              <span className="swatch-mini" style={{ background: c.color }} />
              <small>
                {sort === 'pop' && popKey ? fmtCompact(a?.vals[popKey] ?? 0) : sort === 'regions' ? `${a?.regions ?? 0} reg.` : fmtCompact(a?.area ?? 0) + ' km²'}
              </small>
            </button>
          );
        })}
        {!rows.length && <p className="hint">No country matches.</p>}
      </div>

      {doc.alliances.length > 0 && (
        <div className="alliances">
          <h3>Alliances</h3>
          {doc.alliances.map((al) => (
            <div key={al.id} className="alliance">
              <span className="swatch-mini" style={{ background: al.color }} />
              <strong>{al.name}</strong>
              <small>{al.members.length} members</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
