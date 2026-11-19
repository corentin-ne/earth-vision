import { describe, expect, it } from 'vitest';
import { seeded } from '../src/world/names';
import { CULTURES, NAME_KINDS, generateNames, guessCulture } from '../src/world/cultures';

describe('culture name generator', () => {
  it('is deterministic for a seed', () => {
    expect(generateNames('norse', 'city', 12, seeded(5))).toEqual(generateNames('norse', 'city', 12, seeded(5)));
    expect(generateNames('norse', 'city', 12, seeded(5))).not.toEqual(generateNames('norse', 'city', 12, seeded(6)));
  });

  it('gives every culture 10 unique, new names of each kind', () => {
    for (const c of CULTURES) {
      const seeds = new Set([...c.places, ...(c.people ?? [])].map((x) => x.toLowerCase()));
      for (const { id: kind } of NAME_KINDS) {
        const names = generateNames(c.id, kind, 10, seeded(11));
        expect(names, `${c.id} ${kind}`).toHaveLength(10);
        expect(new Set(names).size).toBe(10);
        for (const n of names) {
          expect(seeds.has(n.toLowerCase()), `${c.id} ${kind} ${n}`).toBe(false);
          expect(n).toMatch(/^[A-Z]/);
          expect(n).not.toMatch(/(.)\1\1|\{|\}/i);
          expect(n.length).toBeGreaterThan(2);
          expect(n.length).toBeLessThan(40);
        }
      }
    }
  });

  it('keeps the training data small and varied', () => {
    expect(CULTURES.length).toBeGreaterThanOrEqual(16);
    expect(new Set(CULTURES.map((c) => c.id)).size).toBe(CULTURES.length);
    for (const c of CULTURES) expect(c.places.length, c.id).toBeGreaterThanOrEqual(40);
  });

  it('guesses a sensible culture for a place', () => {
    expect(guessCulture(2.35, 48.85)).toBe('french');
    expect(guessCulture(10.75, 59.9)).toBe('norse');
    expect(guessCulture(13.4, 52.5)).toBe('germanic');
    expect(guessCulture(139.7, 35.7)).toBe('japanese');
    expect(guessCulture(116.4, 39.9)).toBe('chinese');
    expect(guessCulture(51.4, 35.7)).toBe('persian');
    expect(guessCulture(46.7, 24.7)).toBe('arabic');
    expect(guessCulture(36.8, -1.3)).toBe('bantu');
    expect(guessCulture(-99.1, 19.4)).toBe('nahuatl');
    expect(guessCulture(-157.8, 21.3)).toBe('polynesian');
    expect(guessCulture(37.6, 55.75)).toBe('slavic');
    expect(guessCulture(77.2, 28.6)).toBe('indic');
    expect(guessCulture(23.7, 37.98)).toBe('greek');
    expect(guessCulture(12.5, 41.9)).toBe('latin');
    expect(guessCulture(-0.1, 51.5)).toBe('english');
    expect(guessCulture(-6.26, 53.35)).toBe('celtic');
    expect(guessCulture(32.85, 39.93)).toBe('turkic');
  });
});
