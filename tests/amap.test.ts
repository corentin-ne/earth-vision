import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { exportAmap, importAmap, unzipAmap } from '../src/io/amap';
import { GeoEngine } from '../src/geo/engine';

// Runs against a real A+ World Map Editor file when AMAP_FILE points to one (none is committed).
const FILE = process.env.AMAP_FILE ?? '';
const has = !!FILE && fs.existsSync(FILE);

describe.skipIf(!has)('A+ .map round trip', () => {
  const bytes = has ? new Uint8Array(fs.readFileSync(FILE)) : new Uint8Array();

  it('imports countries, regions, cities and flags', () => {
    const b = importAmap(bytes, 'test.map');
    const nC = Object.keys(b.doc.countries).length;
    const nR = Object.keys(b.doc.regions).length;
    console.log(`${b.doc.meta.title}: ${nC} countries, ${nR} regions, ${Object.keys(b.doc.cities).length} cities, ${Object.keys(b.flags).length} flags`);
    expect(nC).toBeGreaterThan(0);
    expect(nR).toBeGreaterThan(0);
    for (const c of Object.values(b.doc.countries)) expect(c.color).toMatch(/^#[0-9A-F]{6}$/);
    for (const r of Object.values(b.doc.regions)) expect(!!b.doc.countries[r.cid] || r.cid === '').toBe(true);
  });

  it('has a clean shared-border topology', () => {
    const b = importAmap(bytes, 'test.map');
    const e = new GeoEngine();
    e.build(b.geoms);
    const lines = e.borders((id) => b.doc.regions[id]?.cid ?? '');
    expect(lines.countries.coordinates.length).toBeGreaterThan(100);
  });

  it('exports a .map that reads back identically', async () => {
    const b = importAmap(bytes, 'test.map');
    const out = await exportAmap(b);
    expect(String.fromCharCode(...out.slice(0, 4))).toBe('A+WM');
    expect(Object.keys(unzipAmap(out))).toContain('country_simple.json');
    const again = importAmap(out, 'again.map');
    expect(Object.keys(again.doc.regions).length).toBe(Object.keys(b.doc.regions).length);
    expect(Object.keys(again.doc.countries).length).toBe(Object.keys(b.doc.countries).length);
    for (const [id, r] of Object.entries(b.doc.regions)) expect(again.doc.regions[Number(id)].cid).toBe(r.cid);
    const pop = (x: typeof b) => Object.values(x.doc.regions).reduce((s, r) => s + (r.vals?.Population ?? 0), 0);
    expect(Math.abs(pop(b) - pop(again)) / Math.max(1, pop(b))).toBeLessThan(1e-3);
    expect(Object.keys(again.flags).length).toBe(Object.keys(b.flags).length);
  });
});
