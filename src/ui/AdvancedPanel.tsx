import { useState, type ReactNode } from 'react';
import { useWorld, healBorders } from '../world/store';
import {
  recalcPopulation,
  tidyBorders,
  autoColor,
  assignCapitals,
  removeEmptyCountries,
  recenterLabels,
  flagsForAll,
  snapToCoast,
  populationKey,
  runAdvanced,
} from '../world/advanced';
import { Icon, type IconName } from './icons';
import { UpdateRow } from './Updates';
import { fmtInt } from '../util';

const SNAP: [string, number][] = [
  ['Gentle', 0.004],
  ['Normal', 0.01],
  ['Strong', 0.03],
];
const HEAL_STEPS = [1_000, 5_000, 20_000, 50_000, 100_000, 250_000, 1_000_000];

/** Whole-world tools: population, border clean-up, colours, capitals, flags… */
export function AdvancedPanel() {
  const open = useWorld((s) => s.advancedOpen);
  const [busy, setBusy] = useState<string | null>(null);
  const [healStep, setHealStep] = useState(3);
  const [healCountries, setHealCountries] = useState(false);
  const [snap, setSnap] = useState(1);
  if (!open) return null;
  const close = () => useWorld.setState({ advancedOpen: false });
  const popKey = populationKey();
  const { doc, selection } = useWorld.getState();
  const coastOf = selection.cid ? doc?.countries[selection.cid]?.name : null;

  const go = async (id: string, fn: () => unknown, done: (r: unknown) => string) => {
    setBusy(id);
    // Let the spinner paint before heavy synchronous work.
    await new Promise((r) => setTimeout(r, 30));
    await runAdvanced(fn, done);
    setBusy(null);
  };
  const n = (r: unknown) => Number(r) || 0;

  return (
    <div className="modal-back" onClick={close}>
      <div className="modal glass advanced" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="tune" />
          <h2 className="grow">Advanced</h2>
          <button className="icon-btn" onClick={close} title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <UpdateRow />
        <p className="hint">Each action is one step: Ctrl+Z (or the undo button) takes it back.</p>

        <Tool icon="people" title="Recalculate population" desc={popKey ? `Recomputes ${popKey.toLowerCase()} of every region for the current borders, then each country's total follows.` : 'This world has no population statistic.'}>
          <button className="btn primary small" disabled={!popKey || !!busy} onClick={() => go('pop', () => recalcPopulation('real'), String)}>
            {busy === 'pop' ? <span className="spinner small" /> : <Icon name="globe" size={14} />} From real-world data
          </button>
          <button className="btn small" disabled={!popKey || !!busy} onClick={() => go('even', () => recalcPopulation('even'), String)} title="Keeps every country's total, spreads it over its land by area">
            {busy === 'even' ? <span className="spinner small" /> : null} Even spread per country
          </button>
        </Tool>

        <Tool icon="heal" title="Heal map borders" desc="Snaps borders that almost line up so neighbouring regions share them exactly again — removes stray lines and slivers left by imports or old splits. Runs in the background.">
          <div className="segmented inline">
            {SNAP.map(([label], i) => (
              <button key={label} className={snap === i ? 'on' : ''} onClick={() => setSnap(i)}>
                {label}
              </button>
            ))}
          </div>
          <button
            className="btn primary small"
            disabled={!!busy}
            onClick={() => go('heal', () => healBorders(SNAP[snap][1]), (r) => (n(r) ? `Healed the borders of ${n(r)} region${n(r) > 1 ? 's' : ''}` : 'Borders are already clean'))}
          >
            {busy === 'heal' ? <span className="spinner small" /> : <Icon name="heal" size={14} />} {busy === 'heal' ? 'Healing…' : 'Heal'}
          </button>
        </Tool>

        <Tool
          icon="river"
          title="Snap coasts to the real coastline"
          desc={`Regions come with simplified outlines. This replaces every stretch of coast with the detailed coastline, so shores, bays and islands sit where the terrain shows them. ${coastOf ? `Only ${coastOf} (the selected country).` : 'The whole world — select a country first to do only that one.'}`}
        >
          <button
            className="btn primary small"
            disabled={!!busy}
            onClick={() => go('coast', snapToCoast, (r) => (n(r) ? `Coast redrawn for ${n(r)} region${n(r) > 1 ? 's' : ''}` : 'The coasts already follow the coastline'))}
          >
            {busy === 'coast' ? <span className="spinner small" /> : <Icon name="river" size={14} />} {busy === 'coast' ? 'Snapping…' : coastOf ? `Snap ${coastOf}` : 'Snap the world'}
          </button>
        </Tool>

        <Tool icon="bandage" title="Tidy stray pieces" desc="Hands bits of land cut off from their country and surrounded by a single other one to that country, and fills unclaimed holes.">
          <label className="range-row">
            <span>Up to</span>
            <input type="range" min={0} max={HEAL_STEPS.length - 1} value={healStep} onChange={(e) => setHealStep(+e.target.value)} />
            <strong>{fmtInt(HEAL_STEPS[healStep])} km²</strong>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={healCountries} onChange={(e) => setHealCountries(e.target.checked)} />
            Also absorb whole small countries that are enclaved
          </label>
          <button
            className="btn primary small"
            disabled={!!busy}
            onClick={() => go('tidy', () => tidyBorders(HEAL_STEPS[healStep], { countries: healCountries }), (r) => (n(r) ? `Tidied ${n(r)} region${n(r) > 1 ? 's' : ''}` : 'Nothing stray to tidy'))}
          >
            {busy === 'tidy' ? <span className="spinner small" /> : <Icon name="bandage" size={14} />} Tidy
          </button>
        </Tool>

        <div className="tool-grid">
          <QuickTool icon="palette" title="Recolour map" desc="Palette colours, never the same as a neighbour" busy={busy === 'color'} disabled={!!busy} onClick={() => go('color', autoColor, () => 'Map recoloured')} />
          <QuickTool icon="crown" title="Choose capitals" desc="Biggest city of each country without one" busy={busy === 'cap'} disabled={!!busy} onClick={() => go('cap', assignCapitals, (r) => (n(r) ? `${n(r)} new capital${n(r) > 1 ? 's' : ''}` : 'Every country with a city has a capital'))} />
          <QuickTool icon="flag" title="Flags for all" desc="Draws a flag for each country without one" busy={busy === 'flags'} disabled={!!busy} onClick={() => go('flags', flagsForAll, (r) => (n(r) ? `${n(r)} flag${n(r) > 1 ? 's' : ''} drawn` : 'Every country already has a flag'))} />
          <QuickTool icon="target" title="Re-centre names" desc="Country names back to the middle of their land" busy={busy === 'labels'} disabled={!!busy} onClick={() => go('labels', recenterLabels, () => 'Names re-centred')} />
          <QuickTool icon="trash" title="Remove empty countries" desc="Countries that own no land any more" busy={busy === 'empty'} disabled={!!busy} onClick={() => go('empty', removeEmptyCountries, (r) => (n(r) ? `Removed ${n(r)} countr${n(r) > 1 ? 'ies' : 'y'}` : 'No empty country'))} />
        </div>
      </div>
    </div>
  );
}

function Tool({ icon, title, desc, children }: { icon: IconName; title: string; desc: string; children: ReactNode }) {
  return (
    <section className="adv-tool">
      <span className="adv-icon">
        <Icon name={icon} size={18} />
      </span>
      <div className="grow">
        <strong>{title}</strong>
        <p>{desc}</p>
        <div className="adv-actions">{children}</div>
      </div>
    </section>
  );
}

function QuickTool({ icon, title, desc, onClick, busy, disabled }: { icon: IconName; title: string; desc: string; onClick: () => void; busy: boolean; disabled: boolean }) {
  return (
    <button className="quick-tool" onClick={onClick} disabled={disabled}>
      <span className="adv-icon">{busy ? <span className="spinner small" /> : <Icon name={icon} size={16} />}</span>
      <span className="grow">
        <strong>{title}</strong>
        <small>{desc}</small>
      </span>
    </button>
  );
}
