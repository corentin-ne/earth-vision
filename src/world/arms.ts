// Coats of arms as small editable designs: a shield, a field (plain or divided), an optional
// ordinary and charge, tinctures that follow the heraldic rule of tincture, an optional crown
// above and a motto below. The random generator, the editor and the PNG export share one renderer.

export type Tincture = 'or' | 'argent' | 'gules' | 'azure' | 'vert' | 'sable' | 'purpure' | 'tenne' | 'sanguine';
export type ShieldShape = 'heater' | 'french' | 'round' | 'swiss' | 'lozenge';
export type Division = 'plain' | 'pale' | 'fess' | 'bend' | 'bendSinister' | 'quarterly' | 'saltire' | 'chevron' | 'gyronny' | 'paly' | 'barry' | 'bendy' | 'chequy';
export type Ordinary = 'none' | 'chief' | 'pale' | 'fess' | 'bend' | 'chevron' | 'cross' | 'saltire' | 'bordure' | 'pile';
export type Charge = 'none' | 'mullet' | 'crescent' | 'fleur' | 'cross' | 'lion' | 'eagle' | 'tower' | 'crown' | 'sun' | 'key' | 'sword' | 'tree' | 'ship' | 'rose';
export type CrownKind = 'none' | 'crown' | 'coronet';

export interface ArmsSpec {
  shield: ShieldShape;
  division: Division;
  /** The field's tinctures; the second one only shows when the field is divided. */
  field: [Tincture, Tincture];
  ordinary: Ordinary;
  ordinaryTincture: Tincture;
  charge: Charge;
  /** 1, 2 in pale, or 3 set two and one. */
  chargeCount: 1 | 2 | 3;
  chargeTincture: Tincture;
  crown: CrownKind;
  /** Written on a scroll under the shield when not empty. */
  motto?: string;
}

/** The heraldic palette. Metals go on colours and colours on metals. */
export const TINCTURES: { id: Tincture; label: string; name: string; hex: string; metal: boolean }[] = [
  { id: 'or', label: 'Or (gold)', name: 'or', hex: '#f2c230', metal: true },
  { id: 'argent', label: 'Argent (silver)', name: 'argent', hex: '#f4f4f0', metal: true },
  { id: 'gules', label: 'Gules (red)', name: 'gules', hex: '#c8102e', metal: false },
  { id: 'azure', label: 'Azure (blue)', name: 'azure', hex: '#1f4fa3', metal: false },
  { id: 'vert', label: 'Vert (green)', name: 'vert', hex: '#1b7a3a', metal: false },
  { id: 'sable', label: 'Sable (black)', name: 'sable', hex: '#1c1c1c', metal: false },
  { id: 'purpure', label: 'Purpure (purple)', name: 'purpure', hex: '#6b2d8c', metal: false },
  { id: 'tenne', label: 'Tenné (orange)', name: 'tenné', hex: '#c0652a', metal: false },
  { id: 'sanguine', label: 'Sanguine (blood red)', name: 'sanguine', hex: '#7e1f2b', metal: false },
];
const TINT = Object.fromEntries(TINCTURES.map((t) => [t.id, t])) as Record<Tincture, (typeof TINCTURES)[number]>;

export const SHIELDS: { id: ShieldShape; label: string }[] = [
  { id: 'heater', label: 'Heater' },
  { id: 'french', label: 'French' },
  { id: 'swiss', label: 'Swiss' },
  { id: 'round', label: 'Round' },
  { id: 'lozenge', label: 'Lozenge' },
];

/** Field divisions, with the words that open their blazon. */
export const DIVISIONS: { id: Division; label: string; blazon: string }[] = [
  { id: 'plain', label: 'Plain', blazon: '' },
  { id: 'pale', label: 'Per pale', blazon: 'Per pale' },
  { id: 'fess', label: 'Per fess', blazon: 'Per fess' },
  { id: 'bend', label: 'Per bend', blazon: 'Per bend' },
  { id: 'bendSinister', label: 'Per bend sinister', blazon: 'Per bend sinister' },
  { id: 'quarterly', label: 'Quarterly', blazon: 'Quarterly' },
  { id: 'saltire', label: 'Per saltire', blazon: 'Per saltire' },
  { id: 'chevron', label: 'Per chevron', blazon: 'Per chevron' },
  { id: 'gyronny', label: 'Gyronny', blazon: 'Gyronny' },
  { id: 'paly', label: 'Paly', blazon: 'Paly' },
  { id: 'barry', label: 'Barry', blazon: 'Barry' },
  { id: 'bendy', label: 'Bendy', blazon: 'Bendy' },
  { id: 'chequy', label: 'Chequy', blazon: 'Chequy' },
];

export const ORDINARIES: { id: Ordinary; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'chief', label: 'Chief' },
  { id: 'pale', label: 'Pale' },
  { id: 'fess', label: 'Fess' },
  { id: 'bend', label: 'Bend' },
  { id: 'chevron', label: 'Chevron' },
  { id: 'cross', label: 'Cross' },
  { id: 'saltire', label: 'Saltire' },
  { id: 'bordure', label: 'Bordure' },
  { id: 'pile', label: 'Pile' },
];

export const CROWNS: { id: CrownKind; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'crown', label: 'Crown' },
  { id: 'coronet', label: 'Coronet' },
];

export const ARRANGEMENTS: { n: 1 | 2 | 3; label: string }[] = [
  { n: 1, label: 'One' },
  { n: 2, label: 'Two in pale' },
  { n: 3, label: 'Three' },
];

// ── Charges ──────────────────────────────────────────────────────────────────

/** A star polygon around (50, 50) as SVG path data. */
function star(points: number, outer: number, inner: number, turn = -Math.PI / 2, alt?: number): string {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : alt !== undefined && i % 4 === 2 ? alt : outer;
    const a = turn + (i * Math.PI) / points;
    d += (i ? 'L' : 'M') + (50 + r * Math.cos(a)).toFixed(1) + ' ' + (50 + r * Math.sin(a)).toFixed(1);
  }
  return d + 'Z';
}

const circle = (x: number, y: number, r: number) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;

function rosePath(): string {
  let d = '';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    d += circle(+(50 + 22 * Math.cos(a)).toFixed(1), +(50 + 22 * Math.sin(a)).toFixed(1), 19);
  }
  return d + circle(50, 50, 20);
}

/** Charges drawn in a 100 x 100 box, with their blazon names. */
export const CHARGES: { id: Charge; label: string; one: string; many: string; d: string; evenodd?: boolean }[] = [
  { id: 'none', label: 'None', one: '', many: '', d: '' },
  { id: 'mullet', label: 'Star', one: 'mullet', many: 'mullets', d: star(5, 48, 20) },
  {
    id: 'crescent',
    label: 'Crescent',
    one: 'crescent',
    many: 'crescents',
    d: 'M12 28A40 40 0 1 0 88 28A42 42 0 0 1 12 28Z',
  },
  {
    id: 'fleur',
    label: 'Fleur-de-lis',
    one: 'fleur-de-lis',
    many: 'fleurs-de-lis',
    d:
      'M50 4C63 18 66 36 57 54H43C34 36 37 18 50 4Z' +
      'M41 56C21 60 6 46 12 30C16 20 29 20 31 30C24 33 23 42 31 46C35 48 39 51 41 56Z' +
      'M59 56C79 60 94 46 88 30C84 20 71 20 69 30C76 33 77 42 69 46C65 48 61 51 59 56Z' +
      'M28 54H72V63H28Z' +
      'M43 63C40 76 33 84 24 88C35 93 44 88 50 79C56 88 65 93 76 88C67 84 60 76 57 63Z',
  },
  {
    id: 'cross',
    label: 'Cross pattée',
    one: 'cross pattée',
    many: 'crosses pattée',
    d: 'M43 43L31 5H69L57 43L95 31V69L57 57L69 95H31L43 57L5 69V31Z',
  },
  {
    id: 'lion',
    label: 'Lion',
    one: 'lion rampant',
    many: 'lions rampant',
    // Facing dexter (the viewer's left): jagged mane, forepaws raised, tail curled over the back.
    d:
      'M28 10L32 3L37 8L43 3L45 10L52 9L50 17L57 19L53 25L58 31C66 40 68 52 64 62C72 66 74 76 70 84L74 96H60L62 88' +
      'C58 80 54 76 50 74L46 84L36 90L32 84L42 76C40 70 42 64 46 60C42 56 40 52 40 48L28 52L18 50L16 44L26 44L36 42' +
      'L34 36L22 34L14 30L16 24L26 28L34 30C30 30 24 28 22 24L15 23L18 18L16 14L22 13C23 11 25 10 28 10Z' +
      'M66 64C84 62 88 44 82 30L86 28C94 44 90 66 68 70Z M78 24L84 16L90 24L84 32Z',
  },
  {
    id: 'eagle',
    label: 'Eagle',
    one: 'eagle displayed',
    many: 'eagles displayed',
    d:
      circle(50, 16, 9) +
      'M57 13L67 18L57 22Z' +
      'M41 26Q50 21 59 26L61 64Q50 72 39 64Z' +
      'M42 30L4 12L9 23L2 30L11 36L4 45L15 49L10 58L40 54Z' +
      'M58 30L96 12L91 23L98 30L89 36L96 45L85 49L90 58L60 54Z' +
      'M42 64L33 88L44 81L50 92L56 81L67 88L58 64Z' +
      'M42 62L30 75L35 78L45 67Z M58 62L70 75L65 78L55 67Z',
  },
  {
    id: 'tower',
    label: 'Tower',
    one: 'tower',
    many: 'towers',
    evenodd: true,
    d: 'M22 94V40H16V20H28V28H38V20H48V28H52V20H62V28H72V20H84V40H78V94Z M41 94V74Q50 62 59 74V94Z M46 46H54V58H46Z',
  },
  {
    id: 'crown',
    label: 'Crown',
    one: 'crown',
    many: 'crowns',
    d: 'M14 76L8 28L30 50L50 18L70 50L92 28L86 76Z M14 80H86V92H14Z' + circle(8, 26, 5) + circle(50, 15, 5) + circle(92, 26, 5),
  },
  { id: 'sun', label: 'Sun', one: 'sun in splendour', many: 'suns in splendour', d: star(16, 48, 28, -Math.PI / 2, 40) },
  {
    id: 'key',
    label: 'Key',
    one: 'key',
    many: 'keys',
    evenodd: true,
    d: circle(50, 22, 18) + circle(50, 22, 8) + 'M45 40H55V94H45Z M55 70H70V78H55Z M55 84H66V92H55Z',
  },
  {
    id: 'sword',
    label: 'Sword',
    one: 'sword',
    many: 'swords',
    d: 'M50 2L57 14V64H43V14Z M26 64H74V72H26Z M45 72H55V86H45Z' + circle(50, 91, 7),
  },
  {
    id: 'tree',
    label: 'Tree',
    one: 'tree',
    many: 'trees',
    d: 'M44 56H56V84H44Z M32 94Q44 88 44 80H56Q56 88 68 94Z' + circle(50, 28, 22) + circle(30, 46, 17) + circle(70, 46, 17) + circle(50, 54, 18),
  },
  {
    id: 'ship',
    label: 'Ship',
    one: 'ship',
    many: 'ships',
    d: 'M6 62H94L80 86H20Z M48 10H53V62H48Z M55 16Q80 36 55 58Z M46 20Q20 40 46 58Z M53 10L68 14L53 18Z',
  },
  { id: 'rose', label: 'Rose', one: 'rose', many: 'roses', d: rosePath() },
];
const CHARGE = Object.fromEntries(CHARGES.map((c) => [c.id, c])) as Record<Charge, (typeof CHARGES)[number]>;

// ── Tincture helpers ─────────────────────────────────────────────────────────

type Rand = () => number;
const pick = <T>(a: readonly T[], rand: Rand): T => a[Math.floor(rand() * a.length)];

export const isMetal = (t: Tincture) => TINT[t]?.metal ?? false;
export const tinctureHex = (t: Tincture) => TINT[t]?.hex ?? '#888888';

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The heraldic tincture closest to a CSS hex colour (perceptually weighted RGB distance). */
export function nearestTincture(hex: string): Tincture | null {
  const c = rgb(hex);
  if (!c) return null;
  let best: Tincture = 'argent';
  let bestD = Infinity;
  for (const t of TINCTURES) {
    const [r, g, b] = rgb(t.hex)!;
    const rm = (c[0] + r) / 2;
    const d = (2 + rm / 256) * (c[0] - r) ** 2 + 4 * (c[1] - g) ** 2 + (2 + (255 - rm) / 256) * (c[2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = t.id;
    }
  }
  return best;
}

/**
 * True when the arms follow the rule of tincture: on a plain field the ordinary and the charge are
 * of the other kind (metal on colour, colour on metal); a divided field is one metal and one colour,
 * and its charge is a third tincture so it shows on both halves.
 */
export function followsTinctureRule(s: ArmsSpec): boolean {
  if (s.division === 'plain') {
    const fm = isMetal(s.field[0]);
    if (s.ordinary !== 'none' && isMetal(s.ordinaryTincture) === fm) return false;
    if (s.charge !== 'none' && isMetal(s.chargeTincture) === fm) return false;
    return true;
  }
  if (isMetal(s.field[0]) === isMetal(s.field[1])) return false;
  if (s.charge !== 'none' && s.field.includes(s.chargeTincture)) return false;
  return true;
}

// ── Random arms ──────────────────────────────────────────────────────────────

const PATTERNED: Division[] = ['gyronny', 'paly', 'barry', 'bendy', 'chequy'];
const BIG_CHARGES: Charge[] = ['lion', 'eagle', 'ship', 'tree', 'tower'];

/**
 * A random coat of arms that follows the rule of tincture; deterministic for a seeded `rand`.
 * `colors` (a country's colour or its flag colours) steer it towards the nearest tinctures.
 */
export function randomArms(rand: Rand = Math.random, opts: { colors?: string[] } = {}): ArmsSpec {
  const prefer = [...new Set((opts.colors ?? []).map(nearestTincture).filter((t): t is Tincture => !!t))];
  const tincture = (metal: boolean, avoid: Tincture[] = []): Tincture => {
    const pref = prefer.filter((t) => isMetal(t) === metal && !avoid.includes(t));
    if (pref.length && rand() < (metal ? 0.6 : 0.85)) return pick(pref, rand);
    let pool: Tincture[] = metal ? ['or', 'argent'] : rand() < 0.06 ? ['purpure', 'tenne', 'sanguine'] : ['gules', 'azure', 'vert', 'sable', 'gules', 'azure'];
    pool = pool.filter((t) => !avoid.includes(t));
    if (!pool.length) pool = TINCTURES.filter((t) => t.metal === metal && !avoid.includes(t.id)).map((t) => t.id);
    // Both metals taken: fall back to a colour (only happens on divided fields).
    if (!pool.length) pool = TINCTURES.filter((t) => !avoid.includes(t.id)).map((t) => t.id);
    return pick(pool, rand);
  };

  const r = rand();
  const shield: ShieldShape = r < 0.45 ? 'heater' : r < 0.65 ? 'french' : r < 0.78 ? 'round' : r < 0.9 ? 'swiss' : 'lozenge';
  const division: Division = rand() < 0.45 ? 'plain' : pick(DIVISIONS.slice(1), rand).id;
  const plain = division === 'plain';

  let field: [Tincture, Tincture];
  if (plain) {
    const metal = rand() < 0.35;
    const f = tincture(metal);
    field = [f, tincture(!metal)];
  } else {
    const m = tincture(true);
    const c = tincture(false);
    field = rand() < 0.5 ? [m, c] : [c, m];
  }

  let ordinary: Ordinary = 'none';
  if (plain && rand() < 0.55) ordinary = pick(ORDINARIES.slice(1), rand).id;
  else if (!plain && !PATTERNED.includes(division) && rand() < 0.2) ordinary = rand() < 0.5 ? 'chief' : 'bordure';
  const ordinaryTincture = plain ? tincture(!isMetal(field[0])) : tincture(rand() < 0.5, field);

  // Charges sit in the field, so only with no ordinary, a chief or a bordure.
  let charge: Charge = 'none';
  const room = ordinary === 'none' || ordinary === 'chief' || ordinary === 'bordure';
  const chance = PATTERNED.includes(division) ? 0.3 : ordinary === 'none' ? 0.85 : 0.6;
  if (room && rand() < chance) charge = pick(CHARGES.slice(1), rand).id;
  const avoid = ordinary === 'none' ? [] : [ordinaryTincture];
  const chargeTincture = plain ? tincture(!isMetal(field[0]), avoid) : tincture(rand() < 0.6, [...field, ...avoid]);
  const c = rand();
  const chargeCount: 1 | 2 | 3 = BIG_CHARGES.includes(charge) ? (c < 0.8 ? 1 : 3) : c < 0.5 ? 1 : c < 0.65 ? 2 : 3;

  const k = rand();
  const crown: CrownKind = k < 0.68 ? 'none' : k < 0.88 ? 'crown' : 'coronet';
  return { shield, division, field, ordinary, ordinaryTincture, charge, chargeCount, chargeTincture, crown };
}

/** Checks a stored value and fills anything missing, so old or hand-edited data still draws. */
export function normalizeArms(x: unknown): ArmsSpec | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Partial<ArmsSpec>;
  const has = <T>(list: { id: T }[], v: unknown, d: T): T => (list.some((i) => i.id === v) ? (v as T) : d);
  const tin = (v: unknown, d: Tincture) => has(TINCTURES, v, d);
  const field = Array.isArray(o.field) ? o.field : [];
  return {
    shield: has(SHIELDS, o.shield, 'heater'),
    division: has(DIVISIONS, o.division, 'plain'),
    field: [tin(field[0], 'azure'), tin(field[1], 'or')],
    ordinary: has(ORDINARIES, o.ordinary, 'none'),
    ordinaryTincture: tin(o.ordinaryTincture, 'or'),
    charge: has(CHARGES, o.charge, 'none'),
    chargeCount: o.chargeCount === 2 || o.chargeCount === 3 ? o.chargeCount : 1,
    chargeTincture: tin(o.chargeTincture, 'or'),
    crown: has(CROWNS, o.crown, 'none'),
    ...(typeof o.motto === 'string' && o.motto.trim() ? { motto: o.motto.slice(0, 80) } : {}),
  };
}

// ── Blazon ───────────────────────────────────────────────────────────────────

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A readable English blazon, e.g. "Per pale azure and or, a lion rampant gules". */
export function blazon(s: ArmsSpec): string {
  const t = (x: Tincture) => TINT[x]?.name ?? x;
  const div = DIVISIONS.find((d) => d.id === s.division);
  const field = s.division === 'plain' || !div ? cap(t(s.field[0])) : `${div.blazon} ${t(s.field[0])} and ${t(s.field[1])}`;

  let charges = '';
  if (s.charge !== 'none') {
    const c = CHARGE[s.charge];
    if (s.chargeCount === 1) charges = `${/^[aeiou]/.test(c.one) ? 'an' : 'a'} ${c.one} ${t(s.chargeTincture)}`;
    else if (s.chargeCount === 2) charges = `two ${c.many} in pale ${t(s.chargeTincture)}`;
    else charges = `three ${c.many} ${t(s.chargeTincture)}`;
  }
  const ord = s.ordinary === 'none' ? '' : `a ${s.ordinary} ${t(s.ordinaryTincture)}`;

  let body = '';
  if (ord && charges) {
    if (s.ordinary === 'chief') body = `${charges}, ${ord}`;
    else if (s.ordinary === 'bordure') body = `${charges} within ${ord}`;
    else body = `${ord}, overall ${charges}`;
  } else body = ord || charges;

  let text = body ? `${field}, ${body}` : field;
  if (s.crown === 'crown') text += '. Ensigned with a royal crown';
  if (s.crown === 'coronet') text += '. Ensigned with a coronet';
  return text;
}

// ── Drawing ──────────────────────────────────────────────────────────────────

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The shield is drawn in a 100 x 120 box; the crown and the scroll add room above and below. */
const SW = 100;
const SH = 120;
const SIDE = 10;
const CROWN_H = 30;
const MOTTO_H = 28;
const EDGE = 4;
const INK = '#1d1a17';

const SHIELD_PATHS: Record<ShieldShape, string> = {
  heater: 'M0 0H100V52C100 88 76 108 50 120C24 108 0 88 0 52Z',
  french: 'M0 0H100V96Q100 110 86 110H64Q54 110 50 120Q46 110 36 110H14Q0 110 0 96Z',
  round: 'M0 0H100V62A50 58 0 0 1 0 62Z',
  swiss: 'M0 4Q25 12 50 0Q75 12 100 4V60C100 94 74 110 50 120C26 110 0 94 0 60Z',
  lozenge: 'M50 0L98 60L50 120L2 60Z',
};

const hasMotto = (s: ArmsSpec) => !!s.motto?.trim();

/** The size of the whole drawing (shield, crown and scroll), in drawing units. */
export function armsSize(spec: ArmsSpec): [number, number] {
  return [SW + SIDE * 2, (spec.crown !== 'none' ? CROWN_H : EDGE) + SH + (hasMotto(spec) ? MOTTO_H : EDGE)];
}

const paths = new Map<string, Path2D>();
function path(d: string): Path2D {
  let p = paths.get(d);
  if (!p) paths.set(d, (p = new Path2D(d)));
  return p;
}

function poly(ctx: Ctx, color: string, ...pts: number[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawField(ctx: Ctx, s: ArmsSpec) {
  const a = tinctureHex(s.field[0]);
  const b = tinctureHex(s.field[1]);
  ctx.fillStyle = a;
  ctx.fillRect(-5, -5, SW + 10, SH + 10);
  ctx.fillStyle = b;
  switch (s.division) {
    case 'pale':
      ctx.fillRect(50, -5, 55, SH + 10);
      break;
    case 'fess':
      ctx.fillRect(-5, 56, SW + 10, 70);
      break;
    case 'bend':
      poly(ctx, b, 0, 0, 100, 120, 0, 120);
      break;
    case 'bendSinister':
      poly(ctx, b, 100, 0, 0, 120, 100, 120);
      break;
    case 'quarterly':
      ctx.fillRect(50, -5, 55, 61);
      ctx.fillRect(-5, 56, 55, 70);
      break;
    case 'saltire':
      poly(ctx, b, 0, 0, 50, 56, 0, 120);
      poly(ctx, b, 100, 0, 50, 56, 100, 120);
      break;
    case 'chevron':
      poly(ctx, b, -5, 125, -5, 104, 50, 46, 105, 104, 105, 125);
      break;
    case 'gyronny':
      for (let i = 1; i < 8; i += 2) {
        const a0 = (i * Math.PI) / 4 - Math.PI / 2;
        const a1 = a0 + Math.PI / 4;
        poly(ctx, b, 50, 56, 50 + 200 * Math.cos(a0), 56 + 200 * Math.sin(a0), 50 + 200 * Math.cos(a1), 56 + 200 * Math.sin(a1));
      }
      break;
    case 'paly':
      for (let i = 1; i < 6; i += 2) ctx.fillRect((i * SW) / 6, -5, SW / 6, SH + 10);
      break;
    case 'barry':
      for (let i = 1; i < 6; i += 2) ctx.fillRect(-5, (i * SH) / 6, SW + 10, SH / 6);
      break;
    case 'bendy':
      ctx.save();
      ctx.translate(50, 60);
      ctx.rotate(Math.atan2(SH, SW));
      for (let i = -7; i < 7; i += 2) ctx.fillRect(-120, i * 14 + 7, 240, 14);
      ctx.restore();
      break;
    case 'chequy':
      for (let y = 0; y < 7; y++) for (let x = 0; x < 6; x++) if ((x + y) % 2) ctx.fillRect((x * SW) / 6, (y * SH) / 7, SW / 6 + 0.3, SH / 7 + 0.3);
      break;
  }
}

function drawOrdinary(ctx: Ctx, s: ArmsSpec) {
  if (s.ordinary === 'none') return;
  const c = tinctureHex(s.ordinaryTincture);
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  const line = (w: number, ...pts: number[]) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
  };
  switch (s.ordinary) {
    case 'chief':
      ctx.fillRect(-5, -5, SW + 10, 37);
      break;
    case 'pale':
      ctx.fillRect(36, -5, 28, SH + 10);
      break;
    case 'fess':
      ctx.fillRect(-5, 42, SW + 10, 28);
      break;
    case 'bend':
      line(26, -10, -12, 110, 132);
      break;
    case 'chevron':
      line(22, -10, 120, 50, 54, 110, 120);
      break;
    case 'cross':
      ctx.fillRect(39, -5, 22, SH + 10);
      ctx.fillRect(-5, 44, SW + 10, 22);
      break;
    case 'saltire':
      line(20, -10, -12, 110, 132);
      line(20, 110, -12, -10, 132);
      break;
    case 'bordure':
      ctx.lineWidth = 22;
      ctx.lineJoin = 'round';
      ctx.stroke(path(SHIELD_PATHS[s.shield]));
      break;
    case 'pile':
      poly(ctx, c, 22, -5, 78, -5, 50, 100);
      break;
  }
}

/** Where the charges go: centre and size, in shield units. */
function chargeSlots(s: ArmsSpec): { x: number; y: number; size: number }[] {
  const chief = s.ordinary === 'chief';
  let slots: { x: number; y: number; size: number }[];
  if (s.chargeCount === 1) slots = [{ x: 50, y: chief ? 72 : 56, size: chief ? 54 : 70 }];
  else if (s.chargeCount === 2)
    slots = chief
      ? [
          { x: 50, y: 53, size: 30 },
          { x: 50, y: 87, size: 30 },
        ]
      : [
          { x: 50, y: 31, size: 38 },
          { x: 50, y: 79, size: 38 },
        ];
  else
    slots = chief
      ? [
          { x: 30, y: 54, size: 30 },
          { x: 70, y: 54, size: 30 },
          { x: 50, y: 88, size: 30 },
        ]
      : [
          { x: 28, y: 34, size: 36 },
          { x: 72, y: 34, size: 36 },
          { x: 50, y: 80, size: 36 },
        ];
  const shrink = (s.ordinary === 'bordure' ? 0.82 : 1) * (s.shield === 'lozenge' ? 0.78 : 1);
  if (shrink < 1) slots = slots.map((p) => ({ x: 50 + (p.x - 50) * shrink, y: 58 + (p.y - 58) * shrink, size: p.size * shrink }));
  return slots;
}

function drawCharge(ctx: Ctx, charge: Charge, x: number, y: number, size: number, tincture: Tincture) {
  const c = CHARGE[charge];
  if (!c?.d) return;
  const p = path(c.d);
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 100, size / 100);
  ctx.lineJoin = 'round';
  // Stroke first, then fill on top: only the outer contour of overlapping parts shows.
  ctx.strokeStyle = 'rgba(22, 18, 14, 0.9)';
  ctx.lineWidth = Math.max(4, 160 / size);
  ctx.stroke(p);
  ctx.fillStyle = tinctureHex(tincture);
  ctx.fill(p, c.evenodd ? 'evenodd' : 'nonzero');
  if (charge === 'rose') {
    // Seeded proper: a small golden heart (red on a golden rose).
    const seed = path(circle(50, 50, 10));
    ctx.lineWidth = Math.max(3, 120 / size);
    ctx.stroke(seed);
    ctx.fillStyle = tincture === 'or' ? tinctureHex('gules') : tinctureHex('or');
    ctx.fill(seed);
  }
  ctx.restore();
}

function drawShading(ctx: Ctx) {
  const g = ctx.createRadialGradient(32, 26, 4, 50, 60, 95);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.32)');
  g.addColorStop(0.45, 'rgba(255, 255, 255, 0.04)');
  g.addColorStop(0.75, 'rgba(0, 0, 0, 0.04)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0.26)');
  ctx.fillStyle = g;
  ctx.fillRect(-5, -5, SW + 10, SH + 10);
}

function drawCrown(ctx: Ctx, kind: CrownKind) {
  const gold = tinctureHex('or');
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.1;
  const shape = (d: string, fill: string) => {
    const p = path(d);
    ctx.fillStyle = fill;
    ctx.fill(p);
    ctx.stroke(p);
  };
  if (kind === 'crown') {
    shape('M37 22Q37 8 60 8Q83 8 83 22Z', '#9e1b2f');
    ctx.strokeStyle = gold;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(37, 22);
    ctx.quadraticCurveTo(38, 9, 60, 8);
    ctx.quadraticCurveTo(82, 9, 83, 22);
    ctx.moveTo(60, 8);
    ctx.lineTo(60, 22);
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.1;
    shape(circle(60, 6, 3.4), gold);
    shape('M59 0H61V2H59Z', gold);
    shape('M33 21H87V29H33Z', gold);
  } else {
    for (const x of [36, 48, 60, 72, 84]) {
      shape(`M${x - 4} 20L${x} 10L${x + 4} 20Z`, gold);
      shape(circle(x, 8, 2.8), tinctureHex('argent'));
    }
    shape('M33 19H87V28H33Z', gold);
  }
  for (const [i, x] of [40, 50, 60, 70, 80].entries()) shape(circle(x, kind === 'crown' ? 25 : 23.5, 1.8), i % 2 ? tinctureHex('azure') : tinctureHex('gules'));
}

function drawMotto(ctx: Ctx, text: string, y0: number) {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  const shape = (d: string, fill: string) => {
    const p = new Path2D(d);
    ctx.fillStyle = fill;
    ctx.fill(p);
    ctx.stroke(p);
  };
  const y = (v: number) => (y0 + v).toFixed(1);
  shape(`M16 ${y(4)}L2 ${y(0)}L8 ${y(8)}L2 ${y(17)}L16 ${y(17)}Z`, '#d6ccb2');
  shape(`M104 ${y(4)}L118 ${y(0)}L112 ${y(8)}L118 ${y(17)}L104 ${y(17)}Z`, '#d6ccb2');
  shape(`M14 ${y(4)}Q60 ${y(24)} 106 ${y(4)}L106 ${y(17)}Q60 ${y(37)} 14 ${y(17)}Z`, '#f4efe0');

  // The words follow the ribbon's middle line, a quadratic curve from x 14 to 106.
  const words = text.trim().toUpperCase();
  let fs = 8;
  const font = (n: number) => `700 ${n}px Georgia, 'Times New Roman', serif`;
  ctx.font = font(fs);
  const room = 84;
  const wide = ctx.measureText(words).width;
  if (wide > room) {
    fs = Math.max(3.5, (fs * room) / wide);
    ctx.font = font(fs);
  }
  const widths = [...words].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0);
  ctx.fillStyle = '#2a1e14';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let cx = 60 - total / 2;
  [...words].forEach((ch, i) => {
    const mid = cx + widths[i] / 2;
    cx += widths[i];
    const t = Math.min(1, Math.max(0, (mid - 14) / 92));
    const yy = y0 + 10.5 + 2 * t * (1 - t) * 20;
    ctx.save();
    ctx.translate(mid, yy + 0.4);
    ctx.rotate(Math.atan2(40 * (1 - 2 * t), 92));
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
}

/** Draws the arms fitted and centred in a w x h box (in the context's current units). */
export function drawArms(ctx: Ctx, spec: ArmsSpec, w: number, h: number) {
  const [vw, vh] = armsSize(spec);
  const k = Math.min(w / vw, h / vh);
  const top = spec.crown !== 'none' ? CROWN_H : EDGE;
  ctx.save();
  ctx.translate((w - vw * k) / 2, (h - vh * k) / 2);
  ctx.scale(k, k);

  if (spec.crown !== 'none') drawCrown(ctx, spec.crown);

  ctx.save();
  ctx.translate(SIDE, top);
  const outline = path(SHIELD_PATHS[spec.shield] ?? SHIELD_PATHS.heater);
  ctx.save();
  ctx.clip(outline);
  drawField(ctx, spec);
  drawOrdinary(ctx, spec);
  if (spec.charge !== 'none') for (const p of chargeSlots(spec)) drawCharge(ctx, spec.charge, p.x, p.y, p.size, spec.chargeTincture);
  drawShading(ctx);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 4;
  ctx.stroke(outline);
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.4;
  ctx.lineJoin = 'round';
  ctx.stroke(outline);
  ctx.restore();

  if (hasMotto(spec)) drawMotto(ctx, spec.motto!, top + SH - 8);
  ctx.restore();
}

/** The arms as a PNG, `size` pixels tall. */
export async function armsToBlob(spec: ArmsSpec, size = 256): Promise<Blob> {
  const [vw, vh] = armsSize(spec);
  const h = Math.round(size);
  const w = Math.round((size * vw) / vh);
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      drawArms(ctx, spec, w, h);
      return canvas.convertToBlob({ type: 'image/png' });
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  drawArms(ctx, spec, w, h);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the arms'))), 'image/png'));
}
