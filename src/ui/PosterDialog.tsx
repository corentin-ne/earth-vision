import { useState } from 'react';
import { useWorld, countryAggregates, toast } from '../world/store';
import { computeThematic, type LegendItem } from '../world/thematic';
import { LINE_KINDS } from '../world/edits';
import { mapCtl } from '../map/controller';
import { makePoster, type PosterOpts } from '../map/poster';
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

export function PosterDialog() {
  const open = useWorld((s) => s.posterOpen);
  if (!open) return null;
  return <PosterBody />;
}

function PosterBody() {
  const title = useWorld((s) => s.doc?.meta.title ?? '');
  const close = () => useWorld.setState({ posterOpen: false });
  const [o, setO] = useState<Omit<PosterOpts, 'legendTitle' | 'legendItems'>>(() => ({
    title,
    subtitle: new Date().getFullYear().toString(),
    scale: 3,
    cartouche: true,
    legend: true,
    compass: true,
    scaleBar: true,
    frame: true,
    style: 'classic',
  }));
  const [busy, setBusy] = useState(false);
  const c = mapCtl?.map.getContainer();
  const size = c ? `${Math.round(c.clientWidth * o.scale)} × ${Math.round(c.clientHeight * o.scale)} px` : '';
  const go = async () => {
    const map = mapCtl?.map;
    if (!map) return;
    setBusy(true);
    // Panels out of the way: the poster is the whole map.
    useWorld.setState({ detailsOpen: false });
    try {
      const lg = legendFor();
      const blob = await makePoster(map, { ...o, legendTitle: lg.title, legendItems: lg.items }, (on) => mapCtl?.waves.hold(on));
      if (!blob) throw new Error('The browser could not make the image');
      await download(blob, `${fileBase(o.title || title)}-poster.png`, 'image/png');
      toast('Poster saved', 'ok');
      close();
    } catch (e) {
      console.error(e);
      toast('Poster failed: ' + (e as Error).message, 'error');
    } finally {
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
      <p className="hint">The current view, in high resolution, framed like a printed map. Frame the view first, then export.</p>
      <div className="find-form" onKeyDown={(e) => e.stopPropagation()}>
        <input placeholder="Title" value={o.title} onChange={(e) => setO({ ...o, title: e.target.value })} />
        <input placeholder="Subtitle (a year, an era…)" value={o.subtitle} onChange={(e) => setO({ ...o, subtitle: e.target.value })} />
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
