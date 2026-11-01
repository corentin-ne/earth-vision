import { describe, expect, it } from 'vitest';
import type { Region, WorldDoc } from '../src/types';
import { cityList, mergeReal, pieceReal, realList, realOf, regionList, renamed } from '../src/world/lists';

const reg = (id: number, name: string, cid = 'FR', extra: Partial<Region> = {}): Region => ({ id, name, cid, area: 1, cx: 0, cy: 0, ...extra });

describe('real-world origin', () => {
  it('is the name until changed', () => {
    expect(realOf(reg(1, 'Haut-Rhin'))).toEqual(['Haut-Rhin']);
    expect(renamed(reg(1, 'Haut-Rhin'), 'Alsace').real).toEqual(['Haut-Rhin']);
    expect(renamed(renamed(reg(1, 'Haut-Rhin'), 'Alsace'), 'Elsass').real).toEqual(['Haut-Rhin']);
  });
  it('follows splits without stacking', () => {
    const w = { ...reg(1, 'Palatinate'), real: pieceReal(reg(1, 'Palatinate'), 'west') };
    expect(w.real).toEqual(['Palatinate (west)']);
    expect(pieceReal(w, 'north')).toEqual(['Palatinate (part)']);
  });
  it('joins merges and folds pieces back', () => {
    const a = reg(1, 'A', 'FR', { real: ['Haut-Rhin'] });
    const b = reg(2, 'B', 'FR', { real: ['Palatinate (west)'] });
    expect(mergeReal([a, b])).toEqual(['Haut-Rhin', 'Palatinate (west)']);
    const e = reg(3, 'C', 'FR', { real: ['Palatinate (east)'] });
    expect(mergeReal([b, e])).toEqual(['Palatinate']);
  });
});

describe('lists', () => {
  const doc = {
    meta: { id: 'w', title: 'W', created: 0, modified: 0, source: 'earth' },
    settings: { stats: [], fields: [], palette: [] },
    countries: { FR: { cid: 'FR', name: 'France', color: '#000', stats: {}, fields: {}, capital: 2, states: { s: { name: 'Est' } } } },
    regions: {
      1: reg(1, 'Alsace', 'FR', { real: ['Haut-Rhin', 'Palatinate (west)'], state: 's' }),
      2: reg(2, 'Ain'),
      3: reg(3, 'Bavaria', 'DE'),
    },
    cities: { 1: { id: 1, name: 'Lyon', lng: 0, lat: 0, capital: false, pop: 500000 }, 2: { id: 2, name: 'Paris', lng: 0, lat: 0, capital: true, pop: 2000000 }, 3: { id: 3, name: 'Munich', lng: 0, lat: 0, capital: false } },
    water: [],
    alliances: [],
  } as unknown as WorldDoc;

  it('lists regions by state', () => {
    expect(regionList(doc, 'FR')).toBe('France — 2 regions\n\nEst (1)\n  Alsace\n\nNo state (1)\n  Ain');
  });
  it('lists real places', () => {
    const t = realList(doc, 'FR');
    expect(t).toContain('Alsace = Haut-Rhin + Palatinate (west)');
    expect(t).toContain('Ain, Haut-Rhin, Palatinate');
  });
  it('lists cities, capital first', () => {
    expect(cityList(doc, 'FR', { 1: 'FR', 2: 'FR', 3: 'DE' })).toBe('France — 2 cities\n\nParis (capital) — 2,000,000\nLyon — 500,000');
  });
});
