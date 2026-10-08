import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { FeatureCollection } from 'geojson';
import type { City, Country, Region, RegionGeom, WorldBundle } from '../types';
import { geomArea, labelPoint } from '../geo/engine';
import { distributeByArea } from '../world/stats';
import { uid } from '../util';

interface EarthTemplate {
  topology: Topology<{ regions: GeometryCollection<{ name: string; cid: string }> }>;
  countries: { cid: string; name: string; color: string; population: number; gdp: number }[];
  cities: { name: string; lng: number; lat: number; capital: boolean; cid: string; pop: number }[];
}

export const PALETTE = ['#D6C7FF', '#EBCA8A', '#C1E599', '#E7E58F', '#98DDA1', '#83D5F4', '#B1BBF9', '#F4B4C4', '#EAB38F'];

/**
 * A world built from Natural Earth's admin-1 divisions, owned by today's countries
 * (or by nobody, to start from a blank slate).
 */
export interface EarthData {
  regions: FeatureCollection<RegionGeom, { name: string; cid: string }>;
  countries: EarthTemplate['countries'];
  cities: EarthTemplate['cities'];
}

let earthData: Promise<EarthData> | null = null;
/** The bundled Natural Earth template, decoded once and shared. Treat it as read-only. */
export function loadEarthData(): Promise<EarthData> {
  earthData ??= fetch(new URL('data/earth.json', document.baseURI))
    .then((r) => r.json() as Promise<EarthTemplate>)
    .then((tpl) => ({
      regions: feature(tpl.topology, tpl.topology.objects.regions) as EarthData['regions'],
      countries: tpl.countries,
      cities: tpl.cities,
    }));
  earthData.catch(() => (earthData = null));
  return earthData;
}

export async function loadEarth(opts: { unclaimed?: boolean; title?: string } = {}): Promise<WorldBundle> {
  const tpl = await loadEarthData();
  const fc = tpl.regions;

  const regions: Record<number, Region> = {};
  const geoms: Record<number, RegionGeom> = {};
  fc.features.forEach((f, id) => {
    if (!f.geometry) return;
    const lp = labelPoint(f.geometry) ?? [0, 0];
    regions[id] = {
      id,
      name: f.properties.name,
      cid: opts.unclaimed ? '' : f.properties.cid,
      area: geomArea(f.geometry),
      cx: lp[0],
      cy: lp[1],
    };
    geoms[id] = f.geometry;
  });

  const countries: Record<string, Country> = {};
  const cities: Record<number, City> = {};
  if (!opts.unclaimed) {
    const totals: Record<string, Record<string, number>> = {};
    for (const c of tpl.countries) {
      countries[c.cid] = { cid: c.cid, name: c.name, color: c.color, stats: { GDP: c.gdp }, fields: {} };
      totals[c.cid] = { Population: c.population };
    }
    distributeByArea(regions, totals);
  }
  tpl.cities.forEach((c, id) => {
    cities[id] = { id, name: c.name, lng: c.lng, lat: c.lat, capital: !opts.unclaimed && c.capital, pop: c.pop };
    if (!opts.unclaimed && c.capital && countries[c.cid] && countries[c.cid].capital == null) countries[c.cid].capital = id;
  });

  const now = Date.now();
  return {
    doc: {
      meta: {
        id: uid(),
        title: opts.title ?? (opts.unclaimed ? 'Blank Earth' : 'Earth'),
        created: now,
        modified: now,
        source: opts.unclaimed ? 'blank' : 'earth',
      },
      settings: {
        stats: [
          { key: 'Population', scale: true },
          { key: 'GDP', scale: false },
        ],
        fields: ['Leader', 'Government', 'Language', 'Currency', 'Motto'],
        palette: PALETTE,
      },
      countries,
      regions,
      cities,
      water: [],
      alliances: [],
      view: { center: [10, 30], zoom: 1.6 },
    },
    geoms,
    flags: {},
  };
}
