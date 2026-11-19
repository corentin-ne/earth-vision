import { useEffect, useRef, useState } from 'react';
import { mapCtl } from '../map/controller';
import { toast, useWorld } from '../world/store';
import { freezeSeaLevel } from '../world/sealevel';
import { Icon } from './icons';

// ── Sea level ────────────────────────────────────────────────────────────────

const PRESETS: { level: number; label: string; hint: string }[] = [
  { level: -120, label: 'Ice age', hint: '−120 m: the last glacial maximum, 20,000 years ago (Doggerland, Beringia, Sundaland)' },
  { level: 0, label: 'Today', hint: 'Today’s coasts' },
  { level: 10, label: '+10 m', hint: 'Deltas and low coasts go under' },
  { level: 70, label: 'No ice', hint: '+70 m: every glacier and ice sheet melted' },
];

/** The sea-level slider (a view of the map), and making it part of the world. */
export function SeaLevelControl() {
  const level = useWorld((s) => s.seaLevel);
  const [busy, setBusy] = useState<number | null>(null);
  const set = (v: number) => useWorld.setState({ seaLevel: Math.round(v) });
  const freeze = async () => {
    const what = level < 0 ? 'The land the sea uncovers becomes new regions of the countries along the coast.' : 'Every region the sea reaches is cut along the new coast and its drowned part sinks.';
    if (!confirm(`${what}\n\nThis changes your world (one undo step). Go on?`)) return;
    setBusy(0);
    try {
      const n = await freezeSeaLevel(level, (f) => setBusy(f));
      if (n) toast(`Sea level ${level > 0 ? '+' : ''}${level} m is now part of the world (${n} regions changed)`, 'ok');
    } catch (e) {
      console.error(e);
      toast('Could not change the coasts: ' + (e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="sea-level">
      <div className="menu-label">
        <Icon name="seaLevel" size={13} /> Sea level <strong className="sea-value">{level > 0 ? '+' : ''}{level} m</strong>
      </div>
      <input type="range" min={-130} max={100} step={1} value={level} onChange={(e) => set(+e.target.value)} aria-label="Sea level in metres" />
      <div className="sea-presets">
        {PRESETS.map((p) => (
          <button key={p.label} className={'chip-btn small' + (level === p.level ? ' accent' : '')} title={p.hint} onClick={() => set(p.level)}>
            {p.label}
          </button>
        ))}
      </div>
      {level !== 0 && (
        <button className="btn small sea-freeze" disabled={busy != null} onClick={freeze} title="Turn this sea level into real land and coasts of your world">
          <Icon name="check" size={14} /> {busy != null ? `Reshaping the coasts… ${Math.round(busy * 100)}%` : level < 0 ? 'Make the new land part of the world' : 'Sink the drowned land for good'}
        </button>
      )}
      <small className="muted">Only a view until you make it permanent. The sea floods land only once it spills over the hills around it.</small>
    </div>
  );
}

// ── Over the map ─────────────────────────────────────────────────────────────

/** Paper grain and a darker rim when the antique look is on. */
export function PaperOverlay() {
  const on = useWorld((s) => s.mapStyle === 'antique');
  return on ? <div className="paper-overlay" aria-hidden /> : null;
}

/**
 * A glowing ring of atmosphere around the globe (an option): sized and placed from the map's
 * camera at every move, faded out once the globe fills the screen.
 */
export function AtmosphereHalo() {
  const on = useWorld((s) => s.layers.atmosphere && s.globe);
  const night = useWorld((s) => s.mapStyle === 'night');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!on) return;
    let bound: typeof mapCtl = null;
    const place = () => {
      const el = ref.current;
      const ctl = mapCtl;
      if (!el || !ctl) return;
      const m = ctl.map;
      const z = m.getZoom();
      // On the globe, the sphere's radius on screen is the world's width over 2π.
      const r = (512 * 2 ** z) / (2 * Math.PI);
      const c = m.project(m.getCenter());
      // Seen from straight above, the point in the middle of the view is the middle of the disc.
      const cy = c.y;
      el.style.setProperty('--r', `${r}px`);
      el.style.left = `${c.x}px`;
      el.style.top = `${cy}px`;
      el.style.opacity = String(Math.max(0, Math.min(1, (4.2 - z) / 1.5)));
    };
    const bind = () => {
      if (bound === mapCtl || !mapCtl) return;
      bound?.map.off('move', place);
      bound = mapCtl;
      bound.map.on('move', place);
      bound.map.on('resize', place);
      place();
    };
    bind();
    const t = setInterval(bind, 500);
    return () => {
      clearInterval(t);
      bound?.map.off('move', place);
      bound?.map.off('resize', place);
    };
  }, [on]);
  return on ? <div ref={ref} className={'atmo-halo' + (night ? ' night' : '')} aria-hidden /> : null;
}

// ── Climates ─────────────────────────────────────────────────────────────────

interface ClimateClass {
  code: string;
  name: string;
  color: string;
}
let legend: Promise<ClimateClass[]> | null = null;

/** The Köppen classes, grouped by their first letter, under the layer tiles. */
export function ClimateLegend() {
  const [items, setItems] = useState<ClimateClass[] | null>(null);
  useEffect(() => {
    legend ??= fetch(new URL('data/climate-legend.json', document.baseURI)).then((r) => r.json());
    legend.then(setItems, () => {
      legend = null;
      setItems([]);
    });
  }, []);
  if (!items?.length) return null;
  const groups: Record<string, string> = { A: 'Tropical', B: 'Dry', C: 'Temperate', D: 'Continental', E: 'Polar' };
  return (
    <div className="climate-legend">
      {Object.entries(groups).map(([k, label]) => {
        const list = items.filter((i) => i.code.startsWith(k));
        if (!list.length) return null;
        return (
          <div key={k} className="climate-group">
            <div className="menu-label">{label}</div>
            {list.map((i) => (
              <span key={i.code} className="climate-item" title={i.name}>
                <i style={{ background: i.color }} />
                <b>{i.code}</b> {i.name}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
