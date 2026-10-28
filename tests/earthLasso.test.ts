import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { loadEarth } from '../src/io/earth';
import { setBarriers } from '../src/geo/barriers';
import { useWorld, loadWorld } from '../src/world/store';
import { paintLasso } from '../src/world/brush';

// The real Earth: Brazil's states are huge, and a loop the size of a screen is a sliver of them.
const DATA = 'public/data/earth.json';
const has = fs.existsSync(DATA);
(globalThis as { document?: unknown }).document ??= { baseURI: 'file:///earth/' };
globalThis.fetch = (async (u: URL) => ({ json: async () => JSON.parse(fs.readFileSync('public/' + String(u).replace('file:///earth/', ''), 'utf8')) })) as never;

describe.skipIf(!has)('lasso on the real Earth', () => {
  it('takes land north of the Amazon mouth (Pará, Amapá) for French Guiana', async () => {
    loadWorld(await loadEarth());
    setBarriers(null);
    useWorld.setState({ natural: { rivers: 'off', crests: false } });
    const fra = () => Object.values(useWorld.getState().doc!.regions).filter((r) => r.cid === 'FRA').reduce((t, r) => t + r.area, 0);
    const before = fra();
    const loop: [number, number][] = [];
    for (let i = 0; i < 40; i++) loop.push([-52.6 + Math.cos((i / 40) * 2 * Math.PI) * 0.8, -1.2 + Math.sin((i / 40) * 2 * Math.PI) * 0.35]);
    expect(paintLasso(loop, 'FRA', 'exact')).toBeGreaterThan(0);
    // About the loop's land, some 10 000 km².
    expect(fra() - before).toBeGreaterThan(8000);
  });
});
