import { describe, expect, it } from 'vitest';
import { seeded } from '../src/world/names';
import { blazon, followsTinctureRule, isMetal, nearestTincture, normalizeArms, randomArms } from '../src/world/arms';

describe('coats of arms', () => {
  it('are deterministic for a seed', () => {
    expect(randomArms(seeded(42))).toEqual(randomArms(seeded(42)));
    expect(randomArms(seeded(7), { colors: ['#C8102E'] })).toEqual(randomArms(seeded(7), { colors: ['#C8102E'] }));
    const all = new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(randomArms(seeded(i)))));
    expect(all.size).toBeGreaterThan(25);
  });

  it('always follow the rule of tincture', () => {
    for (let i = 0; i < 2000; i++) {
      const s = randomArms(seeded(i), i % 3 ? {} : { colors: ['#00247D', '#FCD116'] });
      expect(followsTinctureRule(s), JSON.stringify(s)).toBe(true);
      if (s.charge !== 'none' && s.division === 'plain') expect(isMetal(s.chargeTincture)).not.toBe(isMetal(s.field[0]));
      if (s.charge !== 'none' && s.division !== 'plain') expect(s.field).not.toContain(s.chargeTincture);
    }
  });

  it('lean towards the given colours', () => {
    expect(nearestTincture('#0b3d91')).toBe('azure');
    expect(nearestTincture('#ffd700')).toBe('or');
    expect(nearestTincture('#008000')).toBe('vert');
    let green = 0;
    for (let i = 0; i < 200; i++) {
      const s = randomArms(seeded(i), { colors: ['#0a7a3a'] });
      if (s.field.includes('vert') || s.ordinaryTincture === 'vert' || s.chargeTincture === 'vert') green++;
    }
    expect(green).toBeGreaterThan(150);
  });

  it('have a readable blazon', () => {
    for (let i = 0; i < 200; i++) {
      const text = blazon(randomArms(seeded(i)));
      expect(text.length).toBeGreaterThan(2);
      expect(text).toMatch(/^[A-Z]/);
      expect(text).not.toMatch(/undefined/);
    }
    expect(
      blazon({ shield: 'heater', division: 'pale', field: ['azure', 'or'], ordinary: 'none', ordinaryTincture: 'or', charge: 'lion', chargeCount: 1, chargeTincture: 'gules', crown: 'none' }),
    ).toBe('Per pale azure and or, a lion rampant gules');
  });

  it('normalise stored values', () => {
    const s = randomArms(seeded(3));
    expect(normalizeArms(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(normalizeArms(null)).toBeUndefined();
    expect(normalizeArms({ shield: 'banana' })?.shield).toBe('heater');
  });
});
