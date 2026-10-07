/**
 * ============================================================================
 * color.ts — Color Space Conversion Utilities
 * ============================================================================
 *
 * Pure functions for converting between Hex, RGB, and HSL color spaces.
 * Used by the globe renderer to resolve per-region colors and by the
 * UI color picker for interactive editing.
 *
 * All functions are stateless and framework-agnostic.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RGB {
  r: number; // [0, 255]
  g: number; // [0, 255]
  b: number; // [0, 255]
}

export interface HSL {
  h: number; // [0, 360)
  s: number; // [0, 100]
  l: number; // [0, 100]
}

export interface RGBNormalized {
  r: number; // [0, 1]
  g: number; // [0, 1]
  b: number; // [0, 1]
}

// ─── Hex → RGB ──────────────────────────────────────────────────────────────

/**
 * Parse a hex color string into RGB components.
 *
 * @param hex  Color string: "#RRGGBB", "#RGB", "RRGGBB", or "RGB".
 * @returns    RGB with values in [0, 255].
 * @throws     If the hex string is malformed.
 */
export function hexToRgb(hex: string): RGB {
  let clean = hex.replace(/^#/, '');

  // Expand shorthand: "F0A" → "FF00AA"
  if (clean.length === 3) {
    clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
  }

  if (clean.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(clean)) {
    throw new Error(`[color] Invalid hex color: "${hex}"`);
  }

  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

/**
 * Parse a hex color string into normalized [0, 1] RGB values.
 * Directly usable as a Three.js Color constructor argument.
 */
export function hexToRgbNormalized(hex: string): RGBNormalized {
  const { r, g, b } = hexToRgb(hex);
  return { r: r / 255, g: g / 255, b: b / 255 };
}

// ─── RGB → Hex ──────────────────────────────────────────────────────────────

/**
 * Convert RGB components to a hex color string.
 *
 * @param r  Red   [0, 255].
 * @param g  Green [0, 255].
 * @param b  Blue  [0, 255].
 * @returns  "#RRGGBB" hex string.
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

// ─── RGB → HSL ──────────────────────────────────────────────────────────────

/**
 * Convert RGB to HSL.
 *
 * @param r  Red   [0, 255].
 * @param g  Green [0, 255].
 * @param b  Blue  [0, 255].
 * @returns  HSL with h ∈ [0, 360), s ∈ [0, 100], l ∈ [0, 100].
 */
export function rgbToHsl(r: number, g: number, b: number): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

    if (max === rn) {
      h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) * 60;
    } else if (max === gn) {
      h = ((bn - rn) / delta + 2) * 60;
    } else {
      h = ((rn - gn) / delta + 4) * 60;
    }
  }

  return {
    h: Math.round(h * 10) / 10,
    s: Math.round(s * 1000) / 10,
    l: Math.round(l * 1000) / 10,
  };
}

// ─── HSL → RGB ──────────────────────────────────────────────────────────────

/**
 * Convert HSL to RGB.
 *
 * @param h  Hue        [0, 360).
 * @param s  Saturation [0, 100].
 * @param l  Lightness  [0, 100].
 * @returns  RGB with values in [0, 255].
 */
export function hslToRgb(h: number, s: number, l: number): RGB {
  const sn = s / 100;
  const ln = l / 100;

  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (h < 60) {
    r1 = c; g1 = x; b1 = 0;
  } else if (h < 120) {
    r1 = x; g1 = c; b1 = 0;
  } else if (h < 180) {
    r1 = 0; g1 = c; b1 = x;
  } else if (h < 240) {
    r1 = 0; g1 = x; b1 = c;
  } else if (h < 300) {
    r1 = x; g1 = 0; b1 = c;
  } else {
    r1 = c; g1 = 0; b1 = x;
  }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

// ─── Hex → HSL ──────────────────────────────────────────────────────────────

/** Convert a hex color string directly to HSL. */
export function hexToHsl(hex: string): HSL {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

/** Convert HSL directly to a hex color string. */
export function hslToHex(h: number, s: number, l: number): string {
  const { r, g, b } = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

// ─── Color Manipulation ─────────────────────────────────────────────────────

/**
 * Lighten a hex color by a percentage.
 *
 * @param hex     Source hex color.
 * @param amount  Percentage to lighten [0, 100].
 * @returns       Lightened hex color.
 */
export function lighten(hex: string, amount: number): string {
  const hsl = hexToHsl(hex);
  hsl.l = Math.min(100, hsl.l + amount);
  return hslToHex(hsl.h, hsl.s, hsl.l);
}

/**
 * Darken a hex color by a percentage.
 *
 * @param hex     Source hex color.
 * @param amount  Percentage to darken [0, 100].
 * @returns       Darkened hex color.
 */
export function darken(hex: string, amount: number): string {
  const hsl = hexToHsl(hex);
  hsl.l = Math.max(0, hsl.l - amount);
  return hslToHex(hsl.h, hsl.s, hsl.l);
}

/**
 * Linear interpolation between two hex colors.
 *
 * @param hexA  Start color.
 * @param hexB  End color.
 * @param t     Interpolation factor [0, 1].
 * @returns     Blended hex color.
 */
export function lerpColor(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const clampedT = Math.max(0, Math.min(1, t));

  return rgbToHex(
    a.r + (b.r - a.r) * clampedT,
    a.g + (b.g - a.g) * clampedT,
    a.b + (b.b - a.b) * clampedT,
  );
}
