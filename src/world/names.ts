// Made-up country names: syllables glued together, plus the odd political title.

const START = ['Ar', 'Bel', 'Cal', 'Dor', 'El', 'Fen', 'Gal', 'Hal', 'Is', 'Kar', 'Lor', 'Mar', 'Nor', 'Os', 'Pel', 'Quen', 'Ros', 'Sal', 'Tor', 'Ul', 'Val', 'Vor', 'Zan', 'Ash', 'Bra', 'Cor', 'Dra', 'Esk', 'Gor', 'Ith', 'Kel', 'Mor', 'Ner', 'Ost', 'Ran', 'Sel', 'Tal', 'Ves', 'Ys', 'Zer'];
const MID = ['a', 'e', 'i', 'o', 'u', 'an', 'en', 'ar', 'or', 'el', 'il', 'ad', 'is', 'om', 'un', 'ev', 'av', ''];
const END = ['ia', 'land', 'dor', 'mark', 'stan', 'ora', 'heim', 'gard', 'ovia', 'esia', 'ar', 'on', 'eth', 'is', 'ura', 'avia', 'oth', 'mir', 'ane', 'ica', 'vale', 'ria', 'enne', 'ados'];
const TITLES = ['Kingdom of', 'Republic of', 'Empire of', 'Grand Duchy of', 'Federation of', 'Commonwealth of', 'United Provinces of', 'Sultanate of', 'Free State of', 'Principality of', 'Confederacy of', 'Serene Republic of'];

type Rand = () => number;
const pick = <T>(a: T[], rand: Rand): T => a[Math.floor(rand() * a.length)];

/** A pronounceable invented country name, e.g. "Velandor" or "Kingdom of Ostmark". */
export function countryName(rand: Rand = Math.random, titleChance = 0.15): string {
  let core = pick(START, rand) + pick(MID, rand) + pick(END, rand);
  core = core.replace(/([aeiou])\1+/g, '$1').replace(/([^aeiou])\1\1+/g, '$1$1');
  return rand() < titleChance ? `${pick(TITLES, rand)} ${core}` : core;
}

/** Small seeded PRNG (mulberry32) so generated worlds can be reproduced from their seed. */
export function seeded(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random pleasant map colour (pastel-ish, readable under dark labels). */
export function randomColor(rand: Rand = Math.random): string {
  const h = Math.floor(rand() * 360);
  const s = 45 + Math.floor(rand() * 30);
  const l = 68 + Math.floor(rand() * 12);
  return hslToHex(h, s, l);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
