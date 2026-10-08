import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Country } from '../types';
import { useWorld, flagUrlFor, countryAggregates } from '../world/store';
import { iso2 } from '../world/flags';
import { useFlagShape } from '../world/flagShape';
import { Icon } from './icons';
import { fmtCompact } from '../util';

/**
 * A country's flag, `size` pixels tall, in the image's own proportions (kept between square-ish
 * and very wide so lists stay tidy). Shaped flags drop the frame for a shadow that follows them.
 */
export function Flag({ country, size = 22 }: { country?: Country; size?: number }) {
  useWorld((s) => (country?.flag ? s.flagUrls[country.flag] : null));
  const url = flagUrlFor(country, iso2);
  const shape = useFlagShape(url);
  const h = size;
  const w = Math.round(size * 1.5);
  if (!country) return <span className="flag flag-none" style={{ width: w, height: h }} />;
  if (!url)
    return (
      <span className="flag flag-none" style={{ width: w, height: h, background: country.color }}>
        {country.cid.slice(0, 3)}
      </span>
    );
  const ratio = Math.min(2.2, Math.max(0.8, shape.ratio));
  return (
    <img
      className={'flag' + (shape.shaped ? ' shaped' : '')}
      src={url}
      alt=""
      style={{ height: h, width: Math.round(h * ratio), aspectRatio: String(ratio) }}
      draggable={false}
    />
  );
}

/** Text input that commits on blur / Enter instead of on every keystroke. */
export function TextField({
  value,
  onCommit,
  placeholder,
  className,
  multiline,
  autoFocus,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  autoFocus?: boolean;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v !== value) onCommit(v);
  };
  if (multiline)
    return <textarea className={className} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} rows={3} />;
  return (
    <input
      className={className}
      value={v}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
        e.stopPropagation();
      }}
    />
  );
}

export function NumberField({ value, onCommit, suffix }: { value: number; onCommit: (v: number) => void; suffix?: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState('');
  if (!editing)
    return (
      <button
        className="num-field"
        title="Click to edit"
        onClick={() => {
          setV(String(Math.round(value)));
          setEditing(true);
        }}
      >
        {fmtCompact(value)}
        {suffix ? <small> {suffix}</small> : null}
      </button>
    );
  const commit = () => {
    setEditing(false);
    const n = Number(v.replace(/[\s,_]/g, ''));
    if (Number.isFinite(n) && n !== Math.round(value)) onCommit(n);
  };
  return (
    <input
      className="num-field editing"
      autoFocus
      inputMode="numeric"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

const NO_COLORS: string[] = [];

export function ColorField({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const palette = useWorld((s) => s.doc?.settings.palette) ?? NO_COLORS;
  const extra = ['#E57373', '#F06292', '#BA68C8', '#7986CB', '#4FC3F7', '#4DB6AC', '#81C784', '#DCE775', '#FFD54F', '#FFB74D', '#A1887F', '#90A4AE'];
  const all = [...new Set([...palette, ...extra].map((c) => c.toUpperCase()))];
  return (
    <div className="color-field">
      {all.map((c) => (
        <button key={c} className={'swatch' + (c === value.toUpperCase() ? ' on' : '')} style={{ background: c }} onClick={() => onChange(c)} title={c} />
      ))}
      <label className="swatch custom" title="Custom colour">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#cccccc'} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <Icon name="plus" size={14} />
      </label>
    </div>
  );
}

/** Searchable country dropdown. */
export function CountryPicker({
  value,
  onChange,
  allowNone,
  noneLabel = 'Unclaimed',
  exclude,
  placeholder = 'Choose a country…',
}: {
  value: string | null;
  onChange: (cid: string) => void;
  allowNone?: boolean;
  noneLabel?: string;
  exclude?: string;
  placeholder?: string;
}) {
  const doc = useWorld((s) => s.doc);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const list = useMemo(() => {
    if (!doc) return [];
    const agg = countryAggregates(doc);
    const ql = q.trim().toLowerCase();
    return Object.values(doc.countries)
      .filter((c) => c.cid !== exclude && (!ql || c.name.toLowerCase().includes(ql) || c.cid.toLowerCase().includes(ql)))
      .sort((a, b) => (agg[b.cid]?.area ?? 0) - (agg[a.cid]?.area ?? 0) || a.name.localeCompare(b.name))
      .slice(0, 200);
  }, [doc, q, exclude]);
  const cur = value ? doc?.countries[value] : undefined;
  return (
    <div className="picker" ref={ref}>
      <button className="picker-btn" onClick={() => setOpen(!open)}>
        {cur ? <Flag country={cur} size={16} /> : <span className="dot-unclaimed" />}
        <span className="picker-label">{cur ? cur.name : value === '' && allowNone ? noneLabel : placeholder}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="picker-pop">
          <input
            autoFocus
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && list[0]) {
                onChange(list[0].cid);
                setOpen(false);
              }
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          <div className="picker-list">
            {allowNone && (
              <button
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
              >
                <span className="dot-unclaimed" /> {noneLabel}
              </button>
            )}
            {list.map((c) => (
              <button
                key={c.cid}
                className={c.cid === value ? 'on' : ''}
                onClick={() => {
                  onChange(c.cid);
                  setOpen(false);
                }}
              >
                <Flag country={c} size={14} />
                <span className="grow">{c.name}</span>
                <span className="swatch-mini" style={{ background: c.color }} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="section">
      <header>
        <h3>{title}</h3>
        {right}
      </header>
      {children}
    </section>
  );
}

export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}
