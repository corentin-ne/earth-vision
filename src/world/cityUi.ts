import { create } from 'zustand';
import type { Candidate } from '../io/osm';

export type Basemap = 'light' | 'streets' | 'dark' | 'blank';

/** What is being done in the city view (not saved with the world, not undone). */
export interface CityUi {
  tab: 'districts' | 'transit';
  /** Districts: pick one, draw one, or add real ones from the map. */
  tool: 'pick' | 'draw' | 'real';
  district: string | null;
  /** The line new stops are added to. */
  line: string | null;
  station: string | null;
  /** Real areas fetched around the city, and which size of them is shown. */
  areas: Candidate[] | null;
  level: number | null;
  loading: boolean;
  /** More towns are being collected around one just added or tapped. */
  growing: boolean;
  basemap: Basemap;
  /** Points of the district being drawn. */
  draft: number;
}

const BASEMAP = 'ev.cityBasemap';
function savedBasemap(): Basemap {
  try {
    const v = localStorage.getItem(BASEMAP);
    if (v === 'light' || v === 'streets' || v === 'dark' || v === 'blank') return v;
  } catch {
    /* ignore */
  }
  return 'light';
}

export const FRESH: Omit<CityUi, 'basemap'> = { tab: 'districts', tool: 'pick', district: null, line: null, station: null, areas: null, level: null, loading: false, growing: false, draft: 0 };

export const useCityUi = create<CityUi>(() => ({ ...FRESH, basemap: savedBasemap() }));

useCityUi.subscribe((s, p) => {
  if (s.basemap === p.basemap) return;
  try {
    localStorage.setItem(BASEMAP, s.basemap);
  } catch {
    /* ignore */
  }
});
