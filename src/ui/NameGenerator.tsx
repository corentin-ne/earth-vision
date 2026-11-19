import { useEffect, useState } from 'react';
import { CULTURES, NAME_KINDS, cultureById, generateNames, type NameKind } from '../world/cultures';
import { toast } from '../world/store';
import { Icon } from './icons';
import './worldgen.css';

const COUNT = 12;

/** Culture and kind pickers and a dozen fresh names; clicking one copies it (and picks it). */
export function NameGeneratorBody({ initialCulture, onPick }: { initialCulture?: string; onPick?: (name: string) => void }) {
  const [culture, setCulture] = useState(() => (initialCulture && cultureById(initialCulture) ? initialCulture : CULTURES[0].id));
  const [kind, setKind] = useState<NameKind>('country');
  const [names, setNames] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const generate = () => setNames(generateNames(culture, kind, COUNT));
  // Fresh names whenever the culture or the kind changes.
  useEffect(() => setNames(generateNames(culture, kind, COUNT)), [culture, kind]);
  useEffect(() => {
    if (initialCulture && cultureById(initialCulture)) setCulture(initialCulture);
  }, [initialCulture]);

  const use = (name: string) => {
    navigator.clipboard?.writeText(name).catch(() => {});
    setCopied(name);
    setTimeout(() => setCopied((c) => (c === name ? null : c)), 1200);
    if (onPick) onPick(name);
    else toast(`Copied “${name}”`, 'ok');
  };

  return (
    <div className="wg-names" onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
      <label className="wg-row">
        <span className="wg-label">Culture</span>
        <select value={culture} onChange={(e) => setCulture(e.target.value)}>
          {CULTURES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <div className="segmented wg-seg wg-kinds">
        {NAME_KINDS.map((k) => (
          <button key={k.id} className={kind === k.id ? 'on' : ''} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      <div className="wg-name-list">
        {names.map((n) => (
          <button key={n} className={'chip-btn wg-name' + (copied === n ? ' copied' : '')} onClick={() => use(n)} title={onPick ? 'Use this name (also copied)' : 'Copy'}>
            {copied === n ? <Icon name="check" size={14} /> : null}
            {n}
          </button>
        ))}
        {!names.length && <p className="hint">No names came out, try again.</p>}
      </div>
      <div className="actions">
        <button className="btn primary" onClick={generate}>
          <Icon name="dice" size={15} /> Generate
        </button>
      </div>
    </div>
  );
}

/** The name generator in a floating window, like the app's other tool windows. */
export function NameGeneratorWindow({ open, onClose, initialCulture, onPick }: { open: boolean; onClose: () => void; initialCulture?: string; onPick?: (name: string) => void }) {
  if (!open) return null;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal glass wg-name-window" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="modal-head">
          <Icon name="sparkle" />
          <h2 className="grow">Name generator</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <NameGeneratorBody initialCulture={initialCulture} onPick={onPick} />
      </div>
    </div>
  );
}
