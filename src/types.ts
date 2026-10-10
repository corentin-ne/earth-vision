import type { MultiPolygon, Polygon } from 'geojson';

export type RegionGeom = Polygon | MultiPolygon;
export type LngLat = [number, number];

/** The atomic piece of land. Countries are just the set of regions they own. */
export interface Region {
  id: number;
  name: string;
  /** Owning country id, '' when unclaimed. */
  cid: string;
  /** km² */
  area: number;
  /** Label anchor. */
  cx: number;
  cy: number;
  /** Values of the "scaling" stats (e.g. population) that travel with the region. */
  vals?: Record<string, number>;
  /** Lore; `[[Name]]` links to a country, region or city. */
  notes?: string;
  /** Country occupying the region while `cid` keeps the legal claim (drawn as stripes). */
  occ?: string;
  /** Key into the owner's `states` (a subdivision of the country). */
  state?: string;
}

/** A first-level subdivision of a country (a state, province, duchy…), grouping regions. */
export interface CountryState {
  name: string;
  color?: string;
}

export interface Country {
  cid: string;
  name: string;
  color: string;
  /** Key into the world's flag images; when absent the bundled ISO flag (if any) is used. */
  flag?: string;
  /** City id of the capital. */
  capital?: number;
  /** Values of the non-scaling stats (e.g. GDP). Scaling stats are summed from regions. */
  stats: Record<string, number>;
  /** Free text fields (leader, language, currency…). */
  fields: Record<string, string>;
  notes?: string;
  /** Label anchor, recomputed whenever the territory changes (unless placed by hand). */
  label?: LngLat;
  /** The label was dragged into place: keep it there when the territory changes. */
  labelFixed?: boolean;
  /**
   * How its land is coloured: 'auto' shades `color` by height (the default), 'gradient' uses
   * `gradient`, 'flag' takes the main colours of its flag.
   */
  colorMode?: 'auto' | 'gradient' | 'flag';
  /** Lowest ground, hills, peaks. */
  gradient?: [string, string, string];
  /** Country this one is a vassal / puppet of. */
  overlord?: string;
  /** Subdivisions, by key (regions point at them with `state`). */
  states?: Record<string, CountryState>;
}

export interface City {
  id: number;
  name: string;
  lng: number;
  lat: number;
  capital: boolean;
  hidden?: boolean;
  pop?: number;
  notes?: string;
}

export interface WaterLabel {
  id: number;
  name: string;
  lng: number;
  lat: number;
}

export interface Alliance {
  id: string;
  name: string;
  color: string;
  members: string[];
}

export type LineKind = 'road' | 'rail' | 'route' | 'sea' | 'front' | 'border';
export type LabelKind = 'sea' | 'land' | 'mountains' | 'note';

/** Something drawn on the map by hand: a line (road, railway, trade route…), a name, or a pin. */
export type Mark =
  | { id: string; type: 'line'; kind: LineKind; name: string; color: string; coords: LngLat[] }
  | { id: string; type: 'label'; kind: LabelKind; text: string; lng: number; lat: number; size: number; angle: number; color?: string }
  | { id: string; type: 'pin'; name: string; icon: string; lng: number; lat: number; notes?: string; color?: string };

export interface StatDef {
  key: string;
  /** Scaling stats live on regions and follow them when they change hands. */
  scale: boolean;
}

export interface WorldSettings {
  stats: StatDef[];
  fields: string[];
  palette: string[];
}

export interface WorldMeta {
  id: string;
  title: string;
  created: number;
  modified: number;
  source: 'amap' | 'earth' | 'blank' | 'cmaps';
  countries?: number;
  regions?: number;
}

export interface ViewState {
  center: LngLat;
  zoom: number;
  bearing?: number;
  pitch?: number;
}

/** Everything about a world except geometry and flag images (stored separately). */
export interface WorldDoc {
  meta: WorldMeta;
  settings: WorldSettings;
  countries: Record<string, Country>;
  regions: Record<number, Region>;
  cities: Record<number, City>;
  water: WaterLabel[];
  alliances: Alliance[];
  /** Hand-drawn lines, names and pins. */
  marks?: Record<string, Mark>;
  /** Ids of the extra data layers (reefs, volcanoes…) shown on this world. */
  overlays?: string[];
  view?: ViewState;
}

export interface WorldBundle {
  doc: WorldDoc;
  geoms: Record<number, RegionGeom>;
  flags: Record<string, Blob>;
  /** Untouched files from an imported A+ .map, written back on export. */
  passthrough?: Record<string, Uint8Array>;
}

/** A set of changes; `null` deletes the entry. */
export interface Patch {
  regions?: Record<number, Region | null>;
  countries?: Record<string, Country | null>;
  cities?: Record<number, City | null>;
  geoms?: Record<number, RegionGeom | null>;
  alliances?: Record<string, Alliance | null>;
  marks?: Record<string, Mark | null>;
}
