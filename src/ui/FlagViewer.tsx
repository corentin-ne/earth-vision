import { useEffect, useMemo, useRef, useState } from 'react';
import type { Country } from '../types';
import { useWorld, countryAggregates, flagUrlFor, select, setFlag, countryBounds } from '../world/store';
import { iso2 } from '../world/flags';
import { randomFlag } from '../world/flagGen';
import { mapCtl } from '../map/controller';
import { Icon } from './icons';
import { download, fmtArea } from '../util';
import { fileBase } from '../io/files';

/** Countries that own land, biggest first: the order flags are browsed in. */
function useCountriesBySize(): Country[] {
  const doc = useWorld((s) => s.doc)!;
  return useMemo(() => {
    const agg = countryAggregates(doc);
    return Object.values(doc.countries)
      .filter((c) => agg[c.cid]?.regions)
      .sort((a, b) => agg[b.cid].area - agg[a.cid].area);
  }, [doc]);
}

function BigFlag({ country }: { country: Country }) {
  useWorld((s) => (country.flag ? s.flagUrls[country.flag] : null));
  const url = flagUrlFor(country, iso2);
  if (!url)
    return (
      <div className="big-flag none" style={{ background: country.color }}>
        {country.cid}
      </div>
    );
  return <img className="big-flag" src={url} alt={`Flag of ${country.name}`} draggable={false} />;
}

/** Full-size view of one country's flag, with ← / → to browse the others. */
export function FlagLightbox() {
  const cid = useWorld((s) => s.flagView);
  const doc = useWorld((s) => s.doc);
  const list = useCountriesBySize();
  const fileRef = useRef<HTMLInputElement>(null);
  const touchX = useRef<number | null>(null);
  const i = list.findIndex((c) => c.cid === cid);
  const c = cid ? doc?.countries[cid] : undefined;
  const go = (d: number) => {
    if (!list.length) return;
    useWorld.setState({ flagView: list[(Math.max(0, i) + d + list.length) % list.length].cid });
  };
  useEffect(() => {
    if (!cid) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape') useWorld.setState({ flagView: null });
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  if (!c) return null;
  const close = () => useWorld.setState({ flagView: null });
  const area = countryAggregates(doc!)[c.cid]?.area ?? 0;
  const url = flagUrlFor(c, iso2);

  return (
    <div
      className="modal-back lightbox"
      onClick={close}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        touchX.current = null;
      }}
    >
      <button className="lb-nav prev" onClick={(e) => (e.stopPropagation(), go(-1))} title="Previous (←)">
        <Icon name="chevron" size={26} style={{ transform: 'scaleX(-1)' }} />
      </button>
      <figure className="lb-figure" onClick={(e) => e.stopPropagation()}>
        <BigFlag country={c} />
        <figcaption>
          <strong>{c.name}</strong>
          <small>
            {i + 1} / {list.length} · {fmtArea(area)}
          </small>
        </figcaption>
        <div className="lb-actions">
          <button className="btn small" onClick={() => fileRef.current?.click()}>
            <Icon name="image" size={14} /> Upload
          </button>
          <button
            className="btn small"
            onClick={async () => {
              const b = await randomFlag(c.color);
              if (b) setFlag(c.cid, b);
            }}
          >
            <Icon name="dice" size={14} /> Random
          </button>
          {url && (
            <button
              className="btn small"
              onClick={async () => {
                const blob = await (await fetch(url)).blob();
                await download(blob, `${fileBase(c.name)} flag.${blob.type === 'image/jpeg' ? 'jpg' : 'png'}`, blob.type);
              }}
            >
              <Icon name="download" size={14} /> Save
            </button>
          )}
          <button
            className="btn small"
            onClick={() => {
              close();
              select({ cid: c.cid });
              mapCtl?.fitBounds(countryBounds(c.cid));
            }}
          >
            <Icon name="target" size={14} /> Show on map
          </button>
          {c.flag && (
            <button className="btn small danger" onClick={() => setFlag(c.cid, null)} title="Back to the default flag">
              <Icon name="trash" size={14} />
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
            if (f) setFlag(c.cid, f);
            e.target.value = '';
          }}
        />
      </figure>
      <button className="lb-nav next" onClick={(e) => (e.stopPropagation(), go(1))} title="Next (→)">
        <Icon name="chevron" size={26} />
      </button>
      <button className="icon-btn lb-close" onClick={close} title="Close (Esc)">
        <Icon name="x" />
      </button>
    </div>
  );
}

/** Every flag of the world at a glance. */
export function FlagGallery() {
  const open = useWorld((s) => s.galleryOpen);
  const list = useCountriesBySize();
  const [q, setQ] = useState('');
  if (!open) return null;
  const close = () => useWorld.setState({ galleryOpen: false });
  const ql = q.trim().toLowerCase();
  const shown = ql ? list.filter((c) => c.name.toLowerCase().includes(ql)) : list;
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal glass gallery" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="flag" />
          <h2 className="grow">Flags of the world</h2>
          <div className="search-mini">
            <Icon name="search" size={14} />
            <input placeholder="Find" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </div>
          <button className="icon-btn" onClick={close} title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <div className="flag-grid">
          {shown.map((c) => (
            <button key={c.cid} className="flag-tile" onClick={() => useWorld.setState({ flagView: c.cid })} title={c.name}>
              <BigFlag country={c} />
              <span>{c.name}</span>
            </button>
          ))}
          {!shown.length && <p className="hint">No country matches.</p>}
        </div>
      </div>
    </div>
  );
}
