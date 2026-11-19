import { useEffect, useState } from 'react';
import { useWorld, countryAggregates, countryBounds, boundsOf, flagUrlFor, toast } from '../world/store';
import { iso2 } from '../world/flags';
import { populationKey } from '../world/advanced';
import { fmtCompact, fmtInt } from '../util';
import { CountryPicker } from './common';
import { armsToBlob } from '../world/arms';
import { computeThematic, type LegendItem } from '../world/thematic';
import { LINE_KINDS } from '../world/edits';
import { mapCtl } from '../map/controller';
import { makePoster, type PosterFocus, type PosterOpts } from '../map/poster';
import { fileBase } from '../io/files';
import { download } from '../util';
import { Window } from './Windows';
import { Icon } from './icons';

/** What the poster's legend lists: the thematic classes, the alliances, or the countries in view. */
function legendFor(): { title: string; items: LegendItem[] } {
  const { doc, thematic, allianceView } = useWorld.getState();
  if (!doc) return { title: '', items: [] };
  if (allianceView) {
    const shown = doc.alliances.filter((a) => allianceView === 'all' || a.id === allianceView);
    return { title: 'Alliances', items: shown.map((a) => ({ color: a.color, label: a.name })) };
  }
  if (thematic) {
    const t = computeThematic(doc, thematic);
    return { title: t.title, items: t.legend };
  }
  const agg = countryAggregates(doc);
  const inView = Object.values(doc.countries)
    .filter((c) => agg[c.cid]?.regions && c.label && mapCtl?.inView([c.label], true))
    .sort((a, b) => (agg[b.cid]?.area ?? 0) - (agg[a.cid]?.area ?? 0))
    .slice(0, 12)
    .map((c) => ({ color: c.color, label: c.name }));
  const kinds = new Set(Object.values(doc.marks ?? {}).flatMap((m) => (m.type === 'line' ? [m.kind] : [])));
  const lines = [...kinds].map((k) => ({ color: LINE_KINDS[k].color, label: LINE_KINDS[k].label }));
  return { title: 'Legend', items: [...inView, ...lines] };
}

type Area = 'view' | 'country' | 'regions';

/** The title block of a country sheet: name, a subtitle and the figures that say most about it. */
function focusFor(area: Area, cid: string, regions: number[]): (PosterFocus & { cid?: string }) | null {
  const doc = useWorld.getState().doc;
  if (!doc) return null;
  const key = populationKey();
  if (area === 'country') {
    const c = doc.countries[cid];
    if (!c) return null;
    const agg = countryAggregates(doc)[cid];
    const facts: [string, string][] = [];
    const capital = c.capital != null ? doc.cities[c.capital]?.name : undefined;
    if (capital) facts.push(['Capital', capital]);
    if (key && agg?.vals[key]) facts.push(['Population', fmtCompact(agg.vals[key])]);
    if (agg?.area) facts.push(['Area', `${fmtInt(agg.area)} km²`]);
    for (const [k, v] of Object.entries(c.fields)) if (v.trim()) facts.push([k, v.trim()]);
    const over = c.overlord && doc.countries[c.overlord]?.name;
    return { name: c.name, subtitle: over ? `Under ${over}` : capital ? `Capital: ${capital}` : '', flag: flagUrlFor(c, iso2), arms: null, cid: c.cid, facts };
  }
  const rs = regions.map((id) => doc.regions[id]).filter(Boolean);
  if (!rs.length) return null;
  const owners = [...new Set(rs.map((r) => r.cid))].map((x) => doc.countries[x]?.name).filter(Boolean) as string[];
  const km2 = rs.reduce((t, r) => t + r.area, 0);
  const pop = key ? rs.reduce((t, r) => t + (r.vals?.[key] ?? 0), 0) : 0;
  const facts: [string, string][] = [];
  if (owners.length) facts.push([owners.length > 1 ? 'Countries' : 'Part of', owners.slice(0, 3).join(', ')]);
  if (pop) facts.push(['Population', fmtCompact(pop)]);
  facts.push(['Area', `${fmtInt(km2)} km²`]);
  if (rs.length > 1) facts.push(['Regions', String(rs.length)]);
  const one = owners.length === 1 ? Object.values(doc.countries).find((c) => c.name === owners[0]) : undefined;
  return {
    name: rs.length === 1 ? rs[0].name : owners.length === 1 ? `${owners[0]}: ${rs.length} regions` : `${rs.length} regions`,
    subtitle: '',
    flag: one ? flagUrlFor(one, iso2) : null,
    arms: null,
    cid: one?.cid,
    facts,
  };
}


export function PosterDialog() {
  const open = useWorld((s) => s.posterOpen);
  if (!open) return null;
  return <PosterBody />;
}

function PosterBody() {
  const title = useWorld((s) => s.doc?.meta.title ?? '');
  const close = () => useWorld.setState({ posterOpen: false, posterFocus: null });
  const sel = useWorld((s) => s.selection);
  const [area, setArea] = useState<Area>('view');
  const [cid, setCid] = useState<string>(() => sel.cid ?? '');
  const [dim, setDim] = useState(true);
  // The regions picked when "Selected regions" was chosen (the selection itself is hidden while rendering).
  const [regions, setRegions] = useState<number[]>(sel.regions);
  // Frame and highlight what the poster shows; everything else fades while the window is open.
  useEffect(() => {
    if (area === 'view') {
      useWorld.setState({ posterFocus: null });
      return;
    }
    const b = area === 'country' ? countryBounds(cid) : boundsOf(regions);
    if (b) mapCtl?.fitBounds(b, 7, { keepDetails: true });
    useWorld.setState({ posterFocus: dim ? (area === 'country' ? { cid } : { regions }) : null });
  }, [area, cid, dim, regions]);
  useEffect(() => () => useWorld.setState({ posterFocus: null }), []);
  const [o, setO] = useState<Omit<PosterOpts, 'legendTitle' | 'legendItems' | 'focus'>>(() => ({
    title,
    subtitle: new Date().getFullYear().toString(),
    scale: 3,
    cartouche: true,
    legend: true,
    compass: true,
    scaleBar: true,
    frame: true,
    style: 'classic',
    layout: 'atlas',
  }));
  const pickArea = (a: Area) => {
    setArea(a);
    if (a === 'regions') setRegions(sel.regions);
    const f = a === 'view' ? null : focusFor(a, cid, a === 'regions' ? sel.regions : regions);
    setO((prev) => ({ ...prev, layout: a === 'view' ? 'atlas' : 'sheet', title: f?.name ?? title, subtitle: a === 'view' ? prev.subtitle : '' }));
  };
  const [busy, setBusy] = useState(false);
  const c = mapCtl?.map.getContainer();
  const size = c ? `${Math.round(c.clientWidth * o.scale)} × ${Math.round(c.clientHeight * o.scale)} px` : '';
  const go = async () => {
    const map = mapCtl?.map;
    if (!map) return;
    setBusy(true);
    // Panels out of the way: the poster is the whole map. The selection outline too (put back after).
    const selection = useWorld.getState().selection;
    useWorld.setState({ detailsOpen: false, selection: { cid: null, regions: [], city: null } });
    try {
      const lg = legendFor();
      const focus = area === 'view' ? undefined : (focusFor(area, cid, regions) ?? undefined);
      // The coat of arms, drawn for the occasion.
      const arms = focus?.cid ? useWorld.getState().doc?.countries[focus.cid]?.arms : undefined;
      if (focus && arms) focus.arms = URL.createObjectURL(await armsToBlob(arms, 256));
      // A sheet of one place lists nothing else in its legend.
      const legend = area === 'view' ? lg : { title: lg.title, items: [] };
      const blob = await makePoster(map, { ...o, focus, legendTitle: legend.title, legendItems: legend.items, legend: o.legend && legend.items.length > 0 }, (on) => mapCtl?.waves.hold(on));
      if (!blob) throw new Error('The browser could not make the image');
      await download(blob, `${fileBase(o.title || title)}-poster.png`, 'image/png');
      toast('Poster saved', 'ok');
      close();
    } catch (e) {
      console.error(e);
      toast('Poster failed: ' + (e as Error).message, 'error');
    } finally {
      useWorld.setState({ selection });
      setBusy(false);
    }
  };
  const flag = (k: 'cartouche' | 'legend' | 'compass' | 'scaleBar' | 'frame', label: string) => (
    <label className="toggle">
      <input type="checkbox" checked={o[k]} onChange={(e) => setO({ ...o, [k]: e.target.checked })} />
      <span className="switch" />
      {label}
    </label>
  );
  return (
    <Window icon="frame" title="Poster" onClose={close}>
      <p className="hint">The map in high resolution, framed like a printed map: the whole view, or just one country or a few regions.</p>
      <div className="poster-row">
        <span>Show</span>
        <div className="segmented">
          <button className={area === 'view' ? 'on' : ''} onClick={() => pickArea('view')}>
            This view
          </button>
          <button className={area === 'country' ? 'on' : ''} onClick={() => pickArea('country')}>
            A country
          </button>
          <button
            className={area === 'regions' ? 'on' : ''}
            disabled={!sel.regions.length}
            title={sel.regions.length ? 'The regions selected on the map' : 'Select regions on the map first (Shift+click)'}
            onClick={() => pickArea('regions')}
          >
            Selected regions
          </button>
        </div>
      </div>
      {area === 'country' && (
        <div className="poster-row">
          <span>Country</span>
          <CountryPicker
            value={cid}
            onChange={(v) => {
              setCid(v);
              setO((prev) => ({ ...prev, title: useWorld.getState().doc?.countries[v]?.name ?? prev.title }));
            }}
          />
        </div>
      )}
      {area !== 'view' && (
        <label className="toggle">
          <input type="checkbox" checked={dim} onChange={(e) => setDim(e.target.checked)} />
          <span className="switch" />
          Fade everything else to grey
        </label>
      )}
      <div className="find-form" onKeyDown={(e) => e.stopPropagation()}>
        <input placeholder="Title" value={o.title} onChange={(e) => setO({ ...o, title: e.target.value })} />
        <input placeholder="Subtitle (a year, an era…)" value={o.subtitle} onChange={(e) => setO({ ...o, subtitle: e.target.value })} />
      </div>
      <div className="poster-row">
        <span>Layout</span>
        <div className="segmented">
          <button className={o.layout === 'atlas' ? 'on' : ''} onClick={() => setO({ ...o, layout: 'atlas' })} title="A title cartouche, legend, compass and scale">
            Atlas page
          </button>
          <button className={o.layout === 'sheet' ? 'on' : ''} disabled={area === 'view'} onClick={() => setO({ ...o, layout: 'sheet' })} title="A big title top left with the flag and key facts">
            Country sheet
          </button>
          <button className={o.layout === 'minimal' ? 'on' : ''} onClick={() => setO({ ...o, layout: 'minimal' })} title="The map full bleed under a large title">
            Minimal
          </button>
        </div>
      </div>
      <div className="poster-row">
        <span>Style</span>
        <div className="segmented">
          <button className={o.style === 'classic' ? 'on' : ''} onClick={() => setO({ ...o, style: 'classic' })}>
            Classic atlas
          </button>
          <button className={o.style === 'modern' ? 'on' : ''} onClick={() => setO({ ...o, style: 'modern' })}>
            Modern
          </button>
          <button className={o.style === 'antique' ? 'on' : ''} onClick={() => setO({ ...o, style: 'antique' })} title="Aged paper: grain, stains and a darker rim">
            Antique
          </button>
        </div>
      </div>
      <div className="poster-row">
        <span>Resolution</span>
        <div className="segmented">
          {[2, 3, 4].map((k) => (
            <button key={k} className={o.scale === k ? 'on' : ''} onClick={() => setO({ ...o, scale: k })}>
              {k}×
            </button>
          ))}
        </div>
        <small>{size}</small>
      </div>
      <div className="toggles">
        {flag('cartouche', 'Title cartouche')}
        {flag('legend', 'Legend')}
        {flag('compass', 'Compass rose')}
        {flag('scaleBar', 'Scale bar')}
        {flag('frame', 'Frame')}
      </div>
      <div className="actions">
        <button className="btn primary" disabled={busy} onClick={go}>
          <Icon name="download" size={15} /> {busy ? 'Rendering…' : 'Save poster (.png)'}
        </button>
      </div>
    </Window>
  );
}
