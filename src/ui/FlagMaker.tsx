import { useEffect, useRef, useState } from 'react';
import { useWorld, setFlag, toast } from '../world/store';
import { drawFlag, flagSize, randomSpec, renderFlag, deepen, FLAG_COLORS, LAYOUTS, EMBLEMS, SHAPES, type FlagSpec, type EmblemPos } from '../world/flagGen';
import { Icon } from './icons';

/** Draws a flag design fitted inside a box of the given CSS size, keeping the shape's proportions. */
function FlagCanvas({ spec, width, height = (width * 2) / 3, className }: { spec: FlagSpec; width: number; height?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [fw, fh] = flagSize(spec);
  const k = Math.min(width / fw, height / fh);
  const w = fw * k;
  const h = fh * k;
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    drawFlag(ctx, spec);
  }, [spec, w, h, k]);
  return <canvas ref={ref} className={className} style={{ width: w, height: h }} />;
}

const POSITIONS: { id: EmblemPos; label: string }[] = [
  { id: 'center', label: 'Centre' },
  { id: 'hoist', label: 'Hoist' },
  { id: 'canton', label: 'Corner' },
];

/** A simple flag editor: layout, colours, emblem, live preview. */
export function FlagMaker() {
  const cid = useWorld((s) => s.flagMakerFor);
  const country = useWorld((s) => (cid ? s.doc?.countries[cid] : undefined));
  const [spec, setSpec] = useState<FlagSpec>(() => randomSpec(country?.color));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (cid) setSpec(randomSpec(useWorld.getState().doc?.countries[cid]?.color));
  }, [cid]);
  if (!cid || !country) return null;

  const close = () => useWorld.setState({ flagMakerFor: null });
  const set = (p: Partial<FlagSpec>) => setSpec((s) => ({ ...s, ...p }));
  const setColor = (i: number, col: string) =>
    setSpec((s) => {
      const colors = [...s.colors] as FlagSpec['colors'];
      colors[i] = col;
      return { ...s, colors };
    });
  const layout = LAYOUTS.find((l) => l.id === spec.layout)!;
  const palette = [...new Set([deepen(country.color), ...FLAG_COLORS, '#1E6BFF', '#FF6A00'])];

  const save = async () => {
    setSaving(true);
    try {
      const blob = await renderFlag(spec);
      if (blob) {
        setFlag(cid, blob);
        toast(`New flag for ${country.name}`, 'ok');
        close();
      }
    } finally {
      setSaving(false);
    }
  };

  const Swatches = ({ value, onPick }: { value: string; onPick: (c: string) => void }) => (
    <div className="fm-swatches">
      {palette.map((c) => (
        <button key={c} className={'swatch' + (c.toUpperCase() === value.toUpperCase() ? ' on' : '')} style={{ background: c }} onClick={() => onPick(c)} title={c} />
      ))}
      <label className="swatch custom" title="Any colour">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#cccccc'} onChange={(e) => onPick(e.target.value.toUpperCase())} />
        <Icon name="plus" size={14} />
      </label>
    </div>
  );

  return (
    <div className="modal-back flag-maker-back" onClick={close}>
      <div className="modal glass flag-maker" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="flag" />
          <h2 className="grow">Flag of {country.name}</h2>
          <button className="icon-btn" onClick={close} title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>

        <div className="fm-body">
          <div className="fm-preview">
            <div className="fm-stage">
              <FlagCanvas spec={spec} width={300} height={230} className={'fm-canvas' + (spec.shape && spec.shape !== 'rect' && spec.shape !== 'wide' && spec.shape !== 'square' ? ' shaped' : '')} />
            </div>
            <button className="btn" onClick={() => setSpec(randomSpec(country.color))}>
              <Icon name="dice" size={15} /> Surprise me
            </button>
          </div>

          <div className="fm-controls">
            <section>
              <h3>Shape</h3>
              <div className="fm-layouts fm-shapes">
                {SHAPES.map((sh) => (
                  <button key={sh.id} className={'fm-layout' + ((spec.shape ?? 'rect') === sh.id ? ' on' : '')} onClick={() => set({ shape: sh.id })} title={sh.label}>
                    <FlagCanvas spec={{ ...spec, shape: sh.id, emblem: 'none' }} width={54} height={40} />
                  </button>
                ))}
              </div>
              {spec.shape === 'flames' && (
                <div className="fm-row">
                  <span className="fm-label">Flames</span>
                  <Swatches value={spec.trim ?? '#1E6BFF'} onPick={(c) => set({ trim: c })} />
                </div>
              )}
            </section>

            <section>
              <h3>Layout</h3>
              <div className="fm-layouts">
                {LAYOUTS.map((l) => (
                  <button key={l.id} className={'fm-layout' + (l.id === spec.layout ? ' on' : '')} onClick={() => set({ layout: l.id })} title={l.label}>
                    <FlagCanvas spec={{ ...spec, layout: l.id, emblem: 'none' }} width={54} />
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3>Colours</h3>
              {layout.parts.map((part, i) => (
                <div key={i} className="fm-row">
                  <span className="fm-label">{part}</span>
                  <Swatches value={spec.colors[i]} onPick={(c) => setColor(i, c)} />
                </div>
              ))}
            </section>

            <section>
              <h3>Emblem</h3>
              <div className="segmented fm-seg">
                {EMBLEMS.map((e) => (
                  <button key={e.id} className={spec.emblem === e.id ? 'on' : ''} onClick={() => set({ emblem: e.id })}>
                    {e.label}
                  </button>
                ))}
              </div>
              {spec.emblem !== 'none' && (
                <>
                  <div className="fm-row">
                    <span className="fm-label">Colour</span>
                    <Swatches value={spec.emblemColor} onPick={(c) => set({ emblemColor: c })} />
                  </div>
                  <div className="fm-row">
                    <span className="fm-label">Place</span>
                    <div className="segmented fm-seg">
                      {POSITIONS.map((p) => (
                        <button key={p.id} className={spec.emblemPos === p.id ? 'on' : ''} onClick={() => set({ emblemPos: p.id })}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="fm-row range-row">
                    <span className="fm-label">Size</span>
                    <input type="range" min={0.5} max={1.5} step={0.05} value={spec.emblemSize} onChange={(e) => set({ emblemSize: +e.target.value })} />
                  </label>
                </>
              )}
            </section>
          </div>
        </div>

        <div className="fm-foot">
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            <Icon name="check" size={15} /> Use this flag
          </button>
        </div>
      </div>
    </div>
  );
}
