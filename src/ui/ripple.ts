/**
 * Liquid-glass press feedback: a ripple spreads from the touch point inside the
 * pressed control, and a fainter wave rolls across the glass panel around it.
 * One delegated listener covers every button, so components need no changes.
 */

const PRESSABLE = 'button:not(:disabled), .toggle, .swatch, .style-chip, .start-card, [data-ripple]';
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A clipping layer appended to `host`, so ripples never clip the host's own popovers. */
function layer(host: HTMLElement): HTMLElement {
  let l = host.querySelector<HTMLElement>(':scope > .ripple-layer');
  if (!l) {
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    l = document.createElement('span');
    l.className = 'ripple-layer';
    host.appendChild(l);
  }
  return l;
}

function spawn(host: HTMLElement, x: number, y: number, cls: string, scale: number) {
  const r = host.getBoundingClientRect();
  const size = Math.hypot(Math.max(x - r.left, r.right - x), Math.max(y - r.top, r.bottom - y)) * 2 * scale;
  const dot = document.createElement('span');
  dot.className = cls;
  dot.style.width = dot.style.height = `${size}px`;
  dot.style.left = `${x - r.left - size / 2}px`;
  dot.style.top = `${y - r.top - size / 2}px`;
  layer(host).appendChild(dot);
  dot.addEventListener('animationend', () => dot.remove(), { once: true });
  // Safety net if the animation never runs (hidden tab, element detached).
  setTimeout(() => dot.remove(), 1500);
}

export function installRipples() {
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 || reduced()) return;
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(PRESSABLE);
      if (!el) return;
      spawn(el, e.clientX, e.clientY, 'ripple', 1);
      const surface = el.parentElement?.closest<HTMLElement>('.glass');
      if (surface) spawn(surface, e.clientX, e.clientY, 'ripple ripple-surface', 0.9);
      if (e.pointerType === 'touch') navigator.vibrate?.(6);
    },
    { passive: true, capture: true },
  );
}
