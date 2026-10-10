import { useEffect, useState } from 'react';
import type { Country } from '../types';
import { useWorld, updateCountry, flagUrlFor } from '../world/store';
import { flagColors, onFlagColors } from '../world/flagColors';
import { LOOKS, autoGradient, vivid } from '../map/style';
import { mix } from '../world/edits';
import { iso2 } from '../world/flags';
import { ColorField } from './common';

type Mode = NonNullable<Country['colorMode']>;
const MODES: [Mode, string, string][] = [
  ['auto', 'Base colour', 'One colour, shaded by height: deeper lowlands, white peaks'],
  ['gradient', 'Gradient', 'Pick the colours of the lowlands, the hills and the peaks'],
  ['flag', 'Flag', 'The main colours of the flag, darkest on the plains'],
];
const STOPS = ['Lowlands', 'Hills', 'Peaks'];

/** The three colours a flag gives (null while it loads or when it has too few). */
function fromFlag(c: Country): [string, string, string] | null {
  const f = flagColors(flagUrlFor(c, iso2));
  if (!f || f.length < 2) return null;
  return [f[0], f.length === 3 ? f[1] : mix(f[0], f[1], 0.5), f[f.length - 1]];
}

/** How a country's land is coloured: from one colour, a gradient of your own, or its flag. */
export function CountryColour({ cid }: { cid: string }) {
  const c = useWorld((s) => s.doc!.countries[cid]);
  const look = useWorld((s) => LOOKS[s.mapStyle]);
  const everyFlag = useWorld((s) => s.layers.flagColors);
  useWorld((s) => (c?.flag ? s.flagUrls[c.flag] : null));
  // Flags are read in the background: redraw when theirs arrives.
  const [, tick] = useState(0);
  useEffect(() => onFlagColors(() => tick((n) => n + 1)), []);
  if (!c) return null;
  const mode: Mode = c.colorMode ?? 'auto';
  const auto = autoGradient(vivid(c.color, look.vivid), look.tint);
  const flag = fromFlag(c);
  const shown = mode === 'gradient' && c.gradient ? c.gradient : mode === 'flag' && flag ? flag : auto;
  const setMode = (m: Mode) => {
    // A gradient starts from what the land looks like now.
    const gradient = m === 'gradient' && !c.gradient ? shown : c.gradient;
    updateCountry(cid, { colorMode: m === 'auto' ? undefined : m, gradient }, 'Change the colours of');
  };
  const setStop = (i: number, color: string) => {
    const g = [...(c.gradient ?? shown)] as [string, string, string];
    g[i] = color;
    // The hills' colour is also the country's colour in lists, legends and flat looks.
    updateCountry(cid, i === 1 ? { gradient: g, color: color.toUpperCase() } : { gradient: g }, 'Recolour country');
  };
  return (
    <div className="country-colour">
      <div className="segmented">
        {MODES.map(([m, label, title]) => (
          <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)} title={title}>
            {label}
          </button>
        ))}
      </div>
      <div className="gradient-bar" style={{ background: `linear-gradient(90deg, ${shown[0]}, ${shown[1]} 55%, ${shown[2]})` }}>
        <span>lowlands</span>
        <span>peaks</span>
      </div>
      {mode === 'auto' && <ColorField value={c.color} onChange={(color) => updateCountry(cid, { color }, 'Recolour country')} />}
      {mode === 'gradient' && (
        <div className="gradient-stops">
          {STOPS.map((label, i) => (
            <label key={label}>
              <span className="stop-swatch" style={{ background: shown[i] }}>
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(shown[i]) ? shown[i] : '#cccccc'} onChange={(e) => setStop(i, e.target.value)} />
              </span>
              {label}
            </label>
          ))}
        </div>
      )}
      {mode === 'flag' && <p className="hint">{flag ? 'Taken from the flag; change the flag to change them.' : 'This flag has one colour (or none yet): the base colour is used.'}</p>}
      {everyFlag && mode !== 'flag' && <p className="hint">“Flag colours for every country” is on in the layers panel: the map shows the flag’s colours for now.</p>}
    </div>
  );
}
