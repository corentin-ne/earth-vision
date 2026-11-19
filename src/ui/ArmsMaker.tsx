import { useEffect, useMemo, useRef } from 'react';
import {
  ARRANGEMENTS,
  CHARGES,
  CROWNS,
  DIVISIONS,
  ORDINARIES,
  SHIELDS,
  TINCTURES,
  armsSize,
  blazon,
  drawArms,
  randomArms,
  type ArmsSpec,
  type Tincture,
} from '../world/arms';
import { TextField } from './common';
import { Icon } from './icons';
import './worldgen.css';

/** A coat of arms drawn `size` CSS pixels tall, in its own proportions. */
export function ArmsImage({ spec, size = 64, className }: { spec: ArmsSpec; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [vw, vh] = armsSize(spec);
  const h = size;
  const w = Math.round((size * vw) / vh);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawArms(ctx, spec, w, h);
  }, [spec, w, h]);
  return <canvas ref={ref} className={'wg-arms-img' + (className ? ' ' + className : '')} style={{ width: w, height: h }} />;
}

/** A row of tincture swatches; metals get a fine ring so gold and silver read as metals. */
function Tinctures({ value, onPick, label }: { value: Tincture; onPick: (t: Tincture) => void; label: string }) {
  return (
    <div className="wg-row">
      <span className="wg-label">{label}</span>
      <div className="wg-tinctures">
        {TINCTURES.map((t) => (
          <button
            key={t.id}
            className={'swatch' + (t.metal ? ' metal' : '') + (t.id === value ? ' on' : '')}
            style={{ background: t.hex }}
            title={t.label}
            aria-label={t.label}
            onClick={() => onPick(t.id)}
          />
        ))}
      </div>
    </div>
  );
}

function Select<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: { id: T; label: string }[]; onPick: (v: T) => void }) {
  return (
    <label className="wg-row">
      <span className="wg-label">{label}</span>
      <select value={value} onChange={(e) => onPick(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * A compact coat-of-arms editor for a country page: live preview with its blazon, pickers for
 * every part, "Surprise me" and "Remove". `colors` (the country's colour, its flag colours) steer
 * the random arms towards the nearest heraldic tinctures.
 */
export function ArmsEditor({ value, onChange, colors }: { value: ArmsSpec | undefined; onChange: (spec: ArmsSpec | undefined) => void; colors?: string[] }) {
  const surprise = () => onChange(randomArms(Math.random, { colors }));
  const text = useMemo(() => (value ? blazon(value) : ''), [value]);

  if (!value)
    return (
      <div className="wg-arms wg-arms-empty">
        <Icon name="shield" size={28} />
        <p className="hint">No coat of arms yet.</p>
        <button className="btn primary" onClick={surprise}>
          <Icon name="dice" size={15} /> Create one
        </button>
      </div>
    );

  const set = (p: Partial<ArmsSpec>) => onChange({ ...value, ...p });
  const divided = value.division !== 'plain';

  return (
    <div className="wg-arms" onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
      <div className="wg-arms-preview">
        <ArmsImage spec={value} size={136} />
        <p className="wg-blazon">{text}</p>
        <div className="wg-arms-actions">
          <button className="btn small" onClick={surprise}>
            <Icon name="dice" size={14} /> Surprise me
          </button>
          <button className="btn small ghost" onClick={() => onChange(undefined)}>
            <Icon name="trash" size={14} /> Remove
          </button>
        </div>
      </div>

      <div className="wg-arms-controls">
        <div className="wg-row">
          <span className="wg-label">Shield</span>
          <div className="segmented wg-seg">
            {SHIELDS.map((s) => (
              <button key={s.id} className={value.shield === s.id ? 'on' : ''} onClick={() => set({ shield: s.id })}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <Select label="Field" value={value.division} options={DIVISIONS} onPick={(division) => set({ division })} />
        <Tinctures label={divided ? 'First' : 'Colour'} value={value.field[0]} onPick={(t) => set({ field: [t, value.field[1]] })} />
        {divided && <Tinctures label="Second" value={value.field[1]} onPick={(t) => set({ field: [value.field[0], t] })} />}

        <Select label="Ordinary" value={value.ordinary} options={ORDINARIES} onPick={(ordinary) => set({ ordinary })} />
        {value.ordinary !== 'none' && <Tinctures label="Colour" value={value.ordinaryTincture} onPick={(ordinaryTincture) => set({ ordinaryTincture })} />}

        <Select label="Charge" value={value.charge} options={CHARGES} onPick={(charge) => set({ charge })} />
        {value.charge !== 'none' && (
          <>
            <div className="wg-row">
              <span className="wg-label">Number</span>
              <div className="segmented wg-seg">
                {ARRANGEMENTS.map((a) => (
                  <button key={a.n} className={value.chargeCount === a.n ? 'on' : ''} onClick={() => set({ chargeCount: a.n })}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
            <Tinctures label="Colour" value={value.chargeTincture} onPick={(chargeTincture) => set({ chargeTincture })} />
          </>
        )}

        <div className="wg-row">
          <span className="wg-label">Above</span>
          <div className="segmented wg-seg">
            {CROWNS.map((c) => (
              <button key={c.id} className={value.crown === c.id ? 'on' : ''} onClick={() => set({ crown: c.id })}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <label className="wg-row">
          <span className="wg-label">Motto</span>
          <TextField
            value={value.motto ?? ''}
            placeholder="e.g. Fortis et liber"
            onCommit={(m) => {
              const motto = m.trim().slice(0, 80);
              const next = { ...value };
              if (motto) next.motto = motto;
              else delete next.motto;
              onChange(next);
            }}
          />
        </label>
      </div>
    </div>
  );
}
