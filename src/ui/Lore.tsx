import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import type { WorldDoc } from '../types';
import { useWorld, select, countryBounds } from '../world/store';
import { mapCtl } from '../map/controller';
import { Icon } from './icons';

type Target = { kind: 'country'; cid: string } | { kind: 'region'; id: number } | { kind: 'city'; id: number } | { kind: 'mark'; id: string };

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** What a `[[Name]]` link points at: a country first, then a city, a region, a named place. */
export function resolveLink(doc: WorldDoc, name: string): Target | null {
  const n = norm(name);
  for (const c of Object.values(doc.countries)) if (norm(c.name) === n || c.cid.toLowerCase() === n) return { kind: 'country', cid: c.cid };
  for (const c of Object.values(doc.cities)) if (norm(c.name) === n) return { kind: 'city', id: c.id };
  for (const r of Object.values(doc.regions)) if (norm(r.name) === n) return { kind: 'region', id: r.id };
  for (const m of Object.values(doc.marks ?? {})) if (norm(m.type === 'label' ? m.text : m.name) === n) return { kind: 'mark', id: m.id };
  return null;
}

/** Goes to a link's target: selects it and brings it into view. */
export function followLink(t: Target) {
  const doc = useWorld.getState().doc;
  if (!doc) return;
  useWorld.setState({ markSel: null });
  if (t.kind === 'country') {
    select({ cid: t.cid });
    mapCtl?.fitBounds(countryBounds(t.cid), 6, { keepDetails: true });
  } else if (t.kind === 'city') {
    const c = doc.cities[t.id];
    select({ city: t.id });
    mapCtl?.flyTo([c.lng, c.lat], 6);
  } else if (t.kind === 'region') {
    const r = doc.regions[t.id];
    select({ cid: r.cid || null, regions: [r.id] });
    mapCtl?.flyTo([r.cx, r.cy], 5.5);
  } else {
    const m = doc.marks?.[t.id];
    if (!m) return;
    select({});
    useWorld.setState({ markSel: t.id });
    const p = m.type === 'line' ? m.coords[Math.floor(m.coords.length / 2)] : ([m.lng, m.lat] as [number, number]);
    mapCtl?.flyTo(p, 5);
  }
}

/** Text with its `[[links]]` made clickable; links to nothing show as plain names. */
function LoreText({ text }: { text: string }) {
  const doc = useWorld((s) => s.doc)!;
  const parts = useMemo(() => {
    const out: ReactNode[] = [];
    const re = /\[\[([^\]]+)\]\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(<Fragment key={k++}>{text.slice(last, m.index)}</Fragment>);
      const [label, alias] = m[1].split('|');
      const t = resolveLink(doc, label);
      out.push(
        t ? (
          <button key={k++} className="lore-link" onClick={() => followLink(t)} title={`Go to ${label}`}>
            {alias ?? label}
          </button>
        ) : (
          <span key={k++} className="lore-missing" title="Nothing has this name yet">
            {alias ?? label}
          </span>
        ),
      );
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
    return out;
  }, [text, doc]);
  return <div className="lore-text">{parts}</div>;
}

/**
 * Lore of a country, region, city or place: reads as text with links, edits as plain text.
 * `[[Name]]` links to anything with that name; `[[Name|shown text]]` shows other words.
 */
export function LoreField({ value, onCommit, placeholder = 'History, culture, lore…' }: { value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const doc = useWorld((s) => s.doc)!;
  const [suggest, setSuggest] = useState<string[]>([]);
  const start = () => {
    setV(value);
    setEditing(true);
    requestAnimationFrame(() => ref.current?.focus());
  };
  const commit = () => {
    setEditing(false);
    setSuggest([]);
    if (v !== value) onCommit(v);
  };
  // Typing "[[Fra" proposes the names that start that way.
  const onType = (text: string, caret: number) => {
    setV(text);
    const open = text.lastIndexOf('[[', caret);
    const close = text.lastIndexOf(']]', caret);
    if (open < 0 || close > open) return setSuggest([]);
    const q = norm(text.slice(open + 2, caret));
    if (q.length < 1 || q.includes('\n')) return setSuggest([]);
    const names = new Set<string>();
    for (const c of Object.values(doc.countries)) if (norm(c.name).startsWith(q)) names.add(c.name);
    for (const c of Object.values(doc.cities)) if (norm(c.name).startsWith(q)) names.add(c.name);
    for (const r of Object.values(doc.regions)) if (names.size < 40 && norm(r.name).startsWith(q)) names.add(r.name);
    setSuggest([...names].slice(0, 6));
  };
  const pick = (name: string) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart;
    const open = v.lastIndexOf('[[', caret);
    const rest = v.slice(caret).replace(/^[^\]\n]*\]\]/, '');
    const next = v.slice(0, open) + `[[${name}]]` + rest;
    setV(next);
    setSuggest([]);
    requestAnimationFrame(() => {
      const at = open + name.length + 4;
      el.focus();
      el.setSelectionRange(at, at);
    });
  };

  if (!editing)
    return (
      <div className="lore">
        {value ? (
          <LoreText text={value} />
        ) : (
          <button className="lore-empty" onClick={start}>
            {placeholder}
          </button>
        )}
        {value && (
          <button className="link lore-edit" onClick={start}>
            <Icon name="edit" size={12} /> Edit
          </button>
        )}
      </div>
    );
  return (
    <div className="lore editing">
      <textarea
        ref={ref}
        value={v}
        rows={5}
        placeholder={placeholder}
        onChange={(e) => onType(e.target.value, e.target.selectionStart)}
        onBlur={() => setTimeout(() => !document.activeElement?.closest('.lore-suggest') && commit(), 120)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            setV(value);
            setEditing(false);
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
          if (e.key === 'Tab' && suggest[0]) {
            e.preventDefault();
            pick(suggest[0]);
          }
        }}
      />
      {suggest.length > 0 && (
        <div className="lore-suggest">
          {suggest.map((n) => (
            <button key={n} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(n)}>
              <Icon name="link" size={12} /> {n}
            </button>
          ))}
        </div>
      )}
      <p className="hint">
        <kbd>[[</kbd>Name<kbd>]]</kbd> links to a country, city, region or place · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to save
      </p>
    </div>
  );
}

/** Everything whose lore links to `name` ("mentioned in"). */
export function useBacklinks(name: string | undefined): { label: string; go: () => void }[] {
  const doc = useWorld((s) => s.doc)!;
  return useMemo(() => {
    if (!name) return [];
    const n = norm(name);
    const mentions = (t?: string) => !!t && [...t.matchAll(/\[\[([^\]|]+)/g)].some((m) => norm(m[1]) === n);
    const out: { label: string; go: () => void }[] = [];
    for (const c of Object.values(doc.countries)) if (mentions(c.notes)) out.push({ label: c.name, go: () => followLink({ kind: 'country', cid: c.cid }) });
    for (const c of Object.values(doc.cities)) if (mentions(c.notes)) out.push({ label: c.name, go: () => followLink({ kind: 'city', id: c.id }) });
    for (const r of Object.values(doc.regions)) if (mentions(r.notes)) out.push({ label: r.name, go: () => followLink({ kind: 'region', id: r.id }) });
    for (const m of Object.values(doc.marks ?? {})) if (m.type === 'pin' && mentions(m.notes)) out.push({ label: m.name, go: () => followLink({ kind: 'mark', id: m.id }) });
    return out.slice(0, 20);
  }, [doc, name]);
}

export function Backlinks({ name }: { name: string }) {
  const links = useBacklinks(name);
  if (!links.length) return null;
  return (
    <div className="backlinks">
      <small>Mentioned in</small>
      {links.map((l, i) => (
        <button key={i} className="lore-link" onClick={l.go}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
