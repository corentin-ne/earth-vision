/**
 * Pointer light on glass panels (SchneiderPocket's metal rim, see theme/spark.css): the rim of the
 * panel under the pointer brightens where the pointer is. One delegated listener, at most one
 * style write per frame, and only on the panel being hovered (--px / --py are not inherited,
 * so nothing inside the panel restyles).
 */
export function installRimLight() {
  if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  let raf = 0;
  let last: { el: HTMLElement; x: number; y: number } | null = null;
  let lit: HTMLElement | null = null;

  const paint = () => {
    raf = 0;
    if (!last) return;
    const { el, x, y } = last;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--px', `${Math.round(x - r.left)}px`);
    el.style.setProperty('--py', `${Math.round(y - r.top)}px`);
    if (lit && lit !== el) {
      // The previous panel's light drifts back to its top edge.
      lit.style.removeProperty('--px');
      lit.style.removeProperty('--py');
    }
    lit = el;
  };

  const onMove = (e: PointerEvent) => {
    const el = (e.target as Element | null)?.closest?.<HTMLElement>('.glass, .hero, .world-card');
    if (!el) return;
    last = { el, x: e.clientX, y: e.clientY };
    raf ||= requestAnimationFrame(paint);
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onMove, { passive: true });
}
