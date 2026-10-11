import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorld, toast } from '../world/store';
import { eraChanges, sortedEras } from '../world/eras';
import { addChapter, deleteChapter, moveChapter, recaptureChapter, restoreChapter, stepChapter, updateChapter, viewChapter } from '../world/timeline';
import { Icon } from './icons';
import { TextField } from './common';
import { fmtCompact } from '../util';
import './timeline.css';

/** Opens the timeline, or closes it (back in the present). */
export function toggleTimeline() {
  const open = useWorld.getState().timelineOpen;
  if (open) viewChapter(null);
  useWorld.setState({ timelineOpen: !open, layersOpen: false });
}

const STEP_MS = 1900;

/**
 * The world's history as a row of chapters: keep the world as it is now, edit on, keep it again —
 * then look back at any chapter, play them in order, or bring the world back to one.
 */
export function TimelineBar() {
  const open = useWorld((s) => s.timelineOpen);
  const eraId = useWorld((s) => s.era);
  // The chapters live in the present; `doc` is a view of it while one is shown.
  const doc = useWorld((s) => s.present ?? s.doc);
  const [playing, setPlaying] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const eras = useMemo(() => sortedEras(doc), [doc?.timeline]);
  const i = eraId ? eras.findIndex((e) => e.id === eraId) : -1;
  const era = i >= 0 ? eras[i] : null;

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      if (!stepChapter(1) || !useWorld.getState().era) setPlaying(false);
    }, STEP_MS);
    return () => clearInterval(t);
  }, [playing]);
  useEffect(() => {
    if (!open) setPlaying(false);
  }, [open]);
  // The chapter shown stays in sight in the row.
  useEffect(() => {
    track.current?.querySelector('.tl-chip.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [eraId, eras.length]);

  // What changed on the way to the moment shown (from the chapter before it).
  const changes = useMemo(() => {
    if (!doc || !eras.length) return [];
    const from = era ? (i > 0 ? eras[i - 1] : null) : eras[eras.length - 1];
    if (era && !from) return [];
    return eraChanges(doc, from, era).slice(0, 4);
  }, [doc?.regions, doc?.timeline, eraId]);

  if (!open || !doc) return null;

  const play = () => {
    if (playing) return setPlaying(false);
    if (eras.length < 1) return;
    // From the start, unless a chapter in the middle is shown.
    if (!era || i === eras.length - 1) viewChapter(eras[0].id);
    setPlaying(true);
  };
  const capture = () => {
    const id = addChapter();
    if (id) toast('Chapter kept · carry on editing, then keep the next one', 'ok');
  };
  const since = era ? (i > 0 ? eras[i - 1].name : '') : eras[eras.length - 1]?.name;

  return (
    <section className={'timeline glass' + (era ? ' in-past' : '')}>
      <header className="tl-head">
        <Icon name="clock" size={17} />
        <h2 className="grow">Timeline</h2>
        {eras.length > 0 && (
          <>
            <button className="icon-btn" onClick={() => stepChapter(-1)} disabled={playing || i === 0} title="Previous chapter (,)">
              <Icon name="chevron" size={16} className="flip" />
            </button>
            <button className={'icon-btn' + (playing ? ' on' : '')} onClick={play} title={playing ? 'Pause' : 'Play the history'}>
              <Icon name={playing ? 'pause' : 'play'} size={16} />
            </button>
            <button className="icon-btn" onClick={() => stepChapter(1)} disabled={playing || !era} title="Next chapter (.)">
              <Icon name="chevron" size={16} />
            </button>
          </>
        )}
        <button className="btn primary small" onClick={capture} title="Keep the world as it is now as a new chapter">
          <Icon name="bookmark" size={14} /> Keep this moment
        </button>
        <button className="icon-btn" onClick={toggleTimeline} title="Close (T)">
          <Icon name="x" size={16} />
        </button>
      </header>

      {eras.length === 0 ? (
        <p className="hint tl-empty">
          Keep the world as it is now, carry on editing — a war, a union, a new border — and keep it again. Each chapter can be looked at, played back in order, or returned to.
        </p>
      ) : (
        <div className="tl-track" ref={track}>
          {eras.map((e) => (
            <button key={e.id} className={'tl-chip' + (e.id === eraId ? ' on' : '')} onClick={() => viewChapter(e.id === eraId ? null : e.id)} title={e.notes || 'Show this chapter on the map'}>
              <small>{e.date || '—'}</small>
              <strong>{e.name}</strong>
            </button>
          ))}
          <button className={'tl-chip now' + (era ? '' : ' on')} onClick={() => viewChapter(null)} title="The world as it is now">
            <small>Now</small>
            <strong>Present</strong>
          </button>
        </div>
      )}

      {era && (
        <div className="tl-edit" key={era.id}>
          <div className="tl-fields">
            <TextField className="tl-date" value={era.date} placeholder="Date" onCommit={(date) => updateChapter(era.id, { date: date.trim() })} />
            <TextField className="tl-name" value={era.name} placeholder="Chapter name" onCommit={(name) => name.trim() && updateChapter(era.id, { name: name.trim() })} />
          </div>
          <TextField className="tl-notes" multiline value={era.notes ?? ''} placeholder="What happened?" onCommit={(notes) => updateChapter(era.id, { notes: notes.trim() })} />
          <div className="tl-actions">
            <button className="icon-btn" onClick={() => moveChapter(era.id, -1)} disabled={i === 0} title="Move earlier">
              <Icon name="chevron" size={15} className="flip" />
            </button>
            <button className="icon-btn" onClick={() => moveChapter(era.id, 1)} disabled={i === eras.length - 1} title="Move later">
              <Icon name="chevron" size={15} />
            </button>
            <span className="grow" />
            <button className="btn small" onClick={() => restoreChapter(era.id)} title="Bring the world back to this chapter (one undo step)">
              <Icon name="back" size={14} /> Return the world here
            </button>
            <button className="btn small" onClick={() => recaptureChapter(era.id)} title="Replace this chapter by the world as it is now">
              <Icon name="bookmark" size={14} /> Overwrite
            </button>
            <button className="icon-btn danger" onClick={() => deleteChapter(era.id)} title="Remove this chapter">
              <Icon name="trash" size={15} />
            </button>
          </div>
        </div>
      )}

      {changes.length > 0 && (
        <div className="tl-changes">
          <small>{since ? `Since ${since}` : 'Changes'}</small>
          {changes.map((c) => (
            <span key={c.cid} className={'tl-change ' + (c.delta >= 0 ? 'up' : 'down')}>
              <i style={{ background: c.color }} />
              {c.name}
              <b>{c.kind === 'born' ? 'appears' : c.kind === 'gone' ? 'is gone' : `${c.delta > 0 ? '+' : '−'}${fmtCompact(Math.abs(c.delta))} km²`}</b>
            </span>
          ))}
        </div>
      )}
      {era && <p className="tl-past">You are looking at the past: the map can’t be changed here.</p>}
    </section>
  );
}
