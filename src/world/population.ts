// Real-world population estimates for any set of regions, whatever their borders.
//
// Reference: each real country's population, minus what lives in its big cities,
// spread over its land by area (a "rural" density per Natural Earth region); the
// cities' own populations are then added to whichever region contains them.
import type { Region, RegionGeom } from '../types';
import { bbox, pointInGeom } from '../geo/engine';
import type { EarthData } from '../io/earth';
import { geomArea } from '../geo/engine';

type Box = [number, number, number, number];

export interface PopulationModel {
  areas: { box: Box; geom: RegionGeom; density: number; cx: number; cy: number }[];
  cities: { lng: number; lat: number; pop: number }[];
}

export function buildPopulationModel(earth: EarthData): PopulationModel {
  const cityPop: Record<string, number> = {};
  for (const c of earth.cities) cityPop[c.cid] = (cityPop[c.cid] ?? 0) + (c.pop || 0);
  const land: Record<string, number> = {};
  const feats = earth.regions.features.filter((f) => f.geometry);
  const areaOf = feats.map((f) => geomArea(f.geometry));
  feats.forEach((f, i) => (land[f.properties.cid] = (land[f.properties.cid] ?? 0) + areaOf[i]));
  const rural: Record<string, number> = {};
  for (const c of earth.countries) {
    // Cities never hold everyone: keep at least a fifth of the people in the countryside.
    rural[c.cid] = Math.max(c.population * 0.2, c.population - (cityPop[c.cid] ?? 0));
  }
  const areas = feats.map((f) => {
    const b = bbox(f.geometry);
    const l = land[f.properties.cid];
    return {
      box: b,
      geom: f.geometry,
      density: l ? (rural[f.properties.cid] ?? 0) / l : 0,
      cx: (b[0] + b[2]) / 2,
      cy: (b[1] + b[3]) / 2,
    };
  });
  const cities = earth.cities.filter((c) => c.pop > 0).map((c) => ({ lng: c.lng, lat: c.lat, pop: c.pop }));
  return { areas, cities };
}

const inBox = (x: number, y: number, b: Box) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/** Estimated population of each region, by id. */
export function estimatePopulation(regions: Region[], geoms: Record<number, RegionGeom>, model: PopulationModel): Record<number, number> {
  const out: Record<number, number> = {};
  for (const r of regions) {
    // The countryside: the density found under the region's label point (or the nearest land).
    let ref = model.areas.find((a) => inBox(r.cx, r.cy, a.box) && pointInGeom([r.cx, r.cy], a.geom));
    if (!ref) {
      let best = Infinity;
      for (const a of model.areas) {
        const d = (a.cx - r.cx) ** 2 + (a.cy - r.cy) ** 2;
        if (d < best) [best, ref] = [d, a];
      }
      // Far from any real land (an invented continent): use a modest density.
      if (best > 15 ** 2) ref = undefined;
    }
    out[r.id] = (ref ? ref.density : 8) * r.area;
  }
  // The cities, where they stand.
  const boxes = regions.filter((r) => geoms[r.id]).map((r) => [r.id, bbox(geoms[r.id])] as const);
  for (const c of model.cities) {
    const hit = boxes.find(([id, b]) => inBox(c.lng, c.lat, b) && pointInGeom([c.lng, c.lat], geoms[id]));
    if (hit) out[hit[0]] += c.pop;
  }
  for (const id of Object.keys(out)) out[+id] = Math.round(out[+id]);
  return out;
}
