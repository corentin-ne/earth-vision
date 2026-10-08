// Snapping a border onto nature: pick the neighbour, the lines to follow, then snap the whole
// shared border or draw a loop around the stretch to change. The rivers and crests show on the
// map meanwhile (see MapController.syncBarriers).
import { useEffect, useMemo, useRef } from 'react';
import { useWorld, countryBounds, boundsOf, setTool, select } from '../world/store';
import { borderRegions, neighbourCountries, runSnap, snapLines } from '../world/natural';
import { mapCtl } from '../map/controller';
import { Flag } from './common';
import { Icon } from './icons';
import { useDockInset, useMobile } from './Editor';

/** Opens the snap card for `cid`, with its longest neighbour preselected. */
export function startSnap(cid: string) {
  setTool('select');
  select({});
  useWorld.setState({ snap: { cid, other: neighbourCountries(cid)[0] ?? null, drawing: false }, detailsOpen: false, worldOpen: false, layersOpen: false });
}

/** Shows the shared border (or the whole country while no neighbour is picked). */
function frame(a: string, b: string | null) {
  const box = b ? boundsOf(borderRegions(a, b)) : countryBounds(a);
  mapCtl?.fitBounds(box, 7, { keepDetails: true });
}

export function SnapCard() {
  const snap = useWorld((s) => s.snap);
  const doc = useWorld((s) => s.doc);
  useWorld((s) => s.natural);
  const mobile = useMobile();
  const neighbours = useMemo(() => (snap ? neighbourCountries(snap.cid) : []), [snap?.cid, doc]);
  const cid = snap?.cid;
  const other = snap?.other ?? null;
  const ref = useRef<HTMLDivElement>(null);
  // The card covers the bottom of the map: frame the border in what stays visible.
  useDockInset(snap?.drawing ? 'snap-drawing' : 'snap', ref, !!snap, true);
  useEffect(() => {
    if (!cid) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => frame(cid, other)));
    return () => cancelAnimationFrame(id);
  }, [cid, other]);
  if (!snap || !doc || !doc.countries[snap.cid]) return null;
  const a = doc.countries[snap.cid];
  const b = snap.other ? doc.countries[snap.other] : undefined;
  const close = () => useWorld.setState({ snap: null });
  const lines = snapLines();
  const setLines = (o: Partial<typeof lines>) => {
    const next = { ...lines, ...o };
    // Something has to be followed.
    if (next.rivers === 'off' && !next.crests) return;
    useWorld.setState({ natural: next });
  };

  if (snap.drawing)
    return (
      <div ref={ref} className="snap-card snap-drawing glass">
        <Icon name="edit" size={16} />
        <span className="grow">
          {mobile ? 'With your finger, draw' : 'Drag to draw'} a loop around the stretch of the {a.name} – {b?.name} border to snap
        </span>
        <button className="btn small" onClick={() => useWorld.setState({ snap: { ...snap, drawing: false } })}>
          Back
        </button>
      </div>
    );

  return (
    <div ref={ref} className="snap-card glass">
      <div className="snap-head">
        <Icon name="river" size={17} />
        <strong className="grow">Snap {a.name}'s border to nature</strong>
        <button className="icon-btn" onClick={close} title="Close">
          <Icon name="x" />
        </button>
      </div>
      <p className="hint">Land that a river or a mountain crest cuts off from its country goes to the neighbour on its side. One undo puts it all back.</p>

      <div className="snap-label">With</div>
      {neighbours.length ? (
        <div className="snap-chips">
          {neighbours.slice(0, 14).map((n) => (
            <button key={n} className={'snap-chip' + (n === snap.other ? ' on' : '')} onClick={() => useWorld.setState({ snap: { ...snap, other: n } })}>
              <Flag country={doc.countries[n]} size={14} />
              <span>{doc.countries[n]?.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="hint">{a.name} has no land border with another country.</p>
      )}

      <div className="snap-label">Follow</div>
      <div className="snap-lines">
        <div className="segmented">
          {(
            [
              ['off', 'No rivers'],
              ['major', 'Big rivers'],
              ['all', 'All rivers'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} className={lines.rivers === v ? 'on' : ''} onClick={() => setLines({ rivers: v })} disabled={v === 'off' && !lines.crests}>
              {label}
            </button>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={lines.crests} disabled={lines.crests && lines.rivers === 'off'} onChange={(e) => setLines({ crests: e.target.checked })} />
          <span className="switch" />
          <Icon name="mountain" size={15} /> Crests
        </label>
      </div>

      <div className="snap-actions">
        <button className="btn" disabled={!b} onClick={() => useWorld.setState({ snap: { ...snap, drawing: true } })} title="Only change the stretch of border you draw a loop around">
          <Icon name="edit" size={15} /> Draw the stretch
        </button>
        <button className="btn primary" disabled={!b} onClick={() => void runSnap()}>
          <Icon name="check" size={15} /> Whole border
        </button>
      </div>
    </div>
  );
}
