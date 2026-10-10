import * as maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, GeoJSONSource, Map as MLMap, MapMouseEvent, PointLike } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, Geometry, Point } from 'geojson';
import type { Country, LngLat, Mark, Region } from '../types';
import { LOOKS, baseStyle, asset, depthRamp, tintRamp, type Look } from './style';
import { WaterLayer, rgb } from './water';
import { dropCuts } from './cuts';
import {
  useWorld,
  engine,
  onWorldChange,
  countryAggregates,
  transferRegions,
  regionsInBox,
  regionAt,
  endGroup,
  select,
  splitAlong,
  addCity,
  updateCity,
  toast,
  mainBody,
  type ChangeSet,
  type State,
} from '../world/store';
import { computeThematic, type ThematicResult } from '../world/thematic';
import { addLand, addMark, moveLabel, newMarkId, updateMark, LINE_KINDS, LABEL_KINDS } from '../world/edits';
import { countryCurve } from './curves';
import { syncOverlays, setOverlayWanted, overlayLayerIds } from './overlays';
import { drawPin } from './pins';
import { loadIso2, iso2 } from '../world/flags';
import { measureImage } from '../world/flagShape';
import { loadBarriers, barriers, naturalOn } from '../geo/barriers';
import { activeNatural, blocked, claimUpToNature, cutAlongNature, reachable, finishSnapLasso, snapLines } from '../world/natural';

maplibregl.setWorkerUrl(workerUrl);

const get = useWorld.getState;
const fc = <G extends Feature['geometry']>(features: Feature<G>[]): FeatureCollection<G> => ({ type: 'FeatureCollection', features });

const REGION_FILLS = ['region-fill', 'region-fill-polar'];
const MARK_LAYERS = ['mark-labels', 'mark-pins', 'mark-solid', 'mark-dash', 'mark-dot', 'mark-casing'];
const LABEL_LAYERS = ['country-labels', 'country-flags', 'country-labels-curved'];

/** Whether a region reaches beyond the mercator square (in practice: Antarctica at the south pole). */
function touchesPole(g: Geometry): boolean {
  const rings = g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];
  return rings.some((r) => r.some((p) => Math.abs(p[1]) > 85));
}

/** Imperative bridge between the world store and MapLibre. */
export class MapController {
  /** Animated surf along the coasts. */
  readonly waves = new Waves(this);
  map: MLMap;
  private loaded = false;
  private regionColor = new Map<number, string>();
  private regionLabelKey = new Map<number, string>();
  private hovered: number | null = null;
  private selected = new Set<number>();
  private flagImages = new Map<string, 'loading' | 'ready' | 'failed'>();
  private unsubs: (() => void)[] = [];
  private borderTimer: ReturnType<typeof setTimeout> | null = null;
  private labelTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBorderRun = 0;
  private drawPts: LngLat[] = [];
  /** A loop being drawn around part of a border to snap (see natural.ts). */
  private lasso: { pts: LngLat[]; last: [number, number] } | null = null;
  /** The paint stroke under way; `anchor` is the last brush spot not cut off by a river or crest. */
  private stroke: { group: string; last: [number, number]; anchor: LngLat | null; blockedAt?: LngLat } | null = null;
  private spaceDown = false;
  private draggingCity: number | null = null;
  /** Dragging a country's name, a hand-placed name or a pin. */
  private dragging: { kind: 'label'; cid: string; at: LngLat | null } | { kind: 'mark'; id: string; at: LngLat | null } | null = null;
  private thematic: ThematicResult | null = null;
  onHover?: (info: { x: number; y: number; region: number | null; city: number | null; text?: string } | null) => void;
  onDrawChange?: (n: number) => void;
  /** The brush outline follows the pointer; `blocked` when a river or crest stops the stroke. */
  onBrush?: (b: { x: number; y: number; r: number; blocked: boolean } | null) => void;

  constructor(container: HTMLElement) {
    const view = get().doc?.view;
    this.map = new maplibregl.Map({
      container,
      style: baseStyle(),
      center: view?.center ?? [10, 30],
      zoom: view?.zoom ?? 1.6,
      bearing: view?.bearing ?? 0,
      pitch: view?.pitch ?? 0,
      maxPitch: 75,
      boxZoom: false,
      attributionControl: false,
      // snapshot() reads the canvas inside a render event, so the costly preserved buffer isn't needed.
      canvasContextAttributes: { preserveDrawingBuffer: false },
      // Beyond 2× the extra pixels cost a lot of GPU time on phones for no visible gain.
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      fadeDuration: 150,
    });
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    this.map.on('load', () => this.onLoad());
    this.map.on('styleimagemissing', (e) => {
      // Placeholder until the real flag loads; avoids console noise.
      if (!this.map.hasImage(e.id)) this.map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
  }

  /** Keeps the visual centre of the map in the part not covered by the inspector. */
  private updatePadding = () => {
    const mobile = window.innerWidth <= 760;
    const docks = Object.values(get().docks);
    const right = Math.max(0, ...docks.map((d) => d.right));
    const bottom = Math.max(0, ...docks.map((d) => d.bottom));
    // Never pad away more than most of the map (a full-height sheet still leaves a strip).
    const h = this.map.getContainer().clientHeight;
    const w = this.map.getContainer().clientWidth;
    const pad = { top: mobile ? 56 : 0, left: 0, bottom: Math.min(bottom, h * 0.6), right: Math.min(right, w * 0.6) };
    const cur = this.map.getPadding();
    if (cur.top === pad.top && cur.left === pad.left && cur.bottom === pad.bottom && cur.right === pad.right) return;
    if (!this.loaded || this.map.isMoving()) {
      this.map.setPadding(pad);
      return;
    }
    // A panel opening or folding changes the padding, which would slide the map under the
    // finger: shift the centre back so what is on screen stays where it is.
    const before = this.map.project(this.map.getCenter());
    this.map.setPadding(pad);
    const after = this.map.project(this.map.getCenter());
    this.map.setCenter(this.map.unproject([2 * after.x - before.x, 2 * after.y - before.y]));
  };

  /** Whether any of the points is in the part of the map not covered by panels (or anywhere on screen with `whole`). */
  inView(points: LngLat[], whole = false): boolean {
    const c = this.map.getContainer();
    const pad: { top?: number; left?: number; right?: number; bottom?: number } = whole ? {} : this.map.getPadding();
    const globe = get().globe;
    const centre = this.map.getCenter();
    return points.some((pt) => {
      if (globe) {
        // Not on the far side of the globe.
        const r = Math.PI / 180;
        const cos = Math.sin(centre.lat * r) * Math.sin(pt[1] * r) + Math.cos(centre.lat * r) * Math.cos(pt[1] * r) * Math.cos((pt[0] - centre.lng) * r);
        if (cos < 0.2) return false;
      }
      const q = this.map.project(pt);
      const { top = 0, left = 0, right = 0, bottom = 0 } = pad;
      return q.x >= left && q.x <= c.clientWidth - right && q.y >= top && q.y <= c.clientHeight - bottom;
    });
  }

  private async onLoad() {
    // Phones: the map credits start folded behind their "i" button.
    if (window.innerWidth <= 760) this.map.getContainer().querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
    this.updatePadding();
    window.addEventListener('resize', this.updatePadding);
    await loadIso2();
    this.addIcons();
    try {
      this.map.addLayer(this.waves.layer, 'graticule');
    } catch (e) {
      console.warn('animated water unavailable', e);
    }
    this.addOverlays();
    setOverlayWanted(() => get().doc?.overlays ?? []);
    this.loaded = true;
    this.applyLook();
    this.syncAll();
    this.bindInteractions();
    this.unsubs.push(onWorldChange((c) => this.onChange(c)));
    this.unsubs.push(
      useWorld.subscribe((s, p) => {
        if (s.mapStyle !== p.mapStyle || s.layers !== p.layers || s.globe !== p.globe) this.applyLook();
        if (s.selection !== p.selection) this.syncSelection();
        if (s.docks !== p.docks) this.updatePadding();
        if (s.tool !== p.tool) this.onToolChange(s, p);
        if (s.tool !== p.tool || s.natural !== p.natural || s.snap !== p.snap) this.syncBarriers();
        if (s.snap?.drawing !== p.snap?.drawing) this.cancelLasso();
        if (s.allianceView !== p.allianceView) {
          this.recolorAll();
          this.syncAlliances();
        }
        if (s.thematic !== p.thematic) this.recolorAll();
        if (s.markSel !== p.markSel) this.syncMarks();
        if (s.drawKind !== p.drawKind && s.tool === 'draw') this.cancelDraw();
        if (s.doc?.overlays !== p.doc?.overlays) this.syncData();
      }),
    );
    // The panel may have reported its size while the map was still loading.
    this.updatePadding();
    this.intro();
    this.map.on('moveend', () => {
      const doc = get().doc;
      if (!doc) return;
      const c = this.map.getCenter();
      useWorld.setState({
        doc: { ...doc, view: { center: [+c.lng.toFixed(4), +c.lat.toFixed(4)], zoom: +this.map.getZoom().toFixed(2), bearing: this.map.getBearing(), pitch: this.map.getPitch() } },
      });
    });
  }

  /** Called once, when the world is drawn and the loading veil can lift. */
  onReady?: () => void;
  private readyTimer = 0;

  /**
   * Waits for the first tiles, then reveals the map with a short glide into the saved view
   * (from a little further out and turned). Gives up waiting after a few seconds so a slow or
   * hidden page never stays behind the veil.
   */
  private intro() {
    const m = this.map;
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = { center: m.getCenter(), zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() };
    if (!reduced) m.jumpTo({ zoom: Math.max(0.6, target.zoom - 0.9), bearing: target.bearing - 16 });
    const started = performance.now();
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      clearInterval(this.readyTimer);
      this.onReady?.();
      if (!reduced) m.easeTo({ ...target, duration: 1700, easing: (t) => 1 - (1 - t) ** 3, essential: true });
    };
    // Polling instead of the 'idle' event: the animated water keeps the map from ever being idle.
    this.readyTimer = window.setInterval(() => {
      if ((m.isStyleLoaded() && m.areTilesLoaded()) || performance.now() - started > 3500) go();
    }, 120);
  }

  destroy() {
    clearInterval(this.readyTimer);
    this.waves.stop();
    this.unsubs.forEach((u) => u());
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.updatePadding);
    this.map.remove();
  }

  private src(id: string) {
    return this.map.getSource(id) as GeoJSONSource | undefined;
  }

  // ── Look ─────────────────────────────────────────────────────────────────

  applyLook() {
    if (!this.loaded) return;
    const { mapStyle, layers, globe, doc } = get();
    const L = LOOKS[mapStyle];
    const m = this.map;
    const vis = (id: string, on: boolean) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    const paint = (id: string, prop: string, value: unknown) => m.getLayer(id) && m.setPaintProperty(id, prop as never, value as never);

    m.setProjection({ type: globe ? 'globe' : 'mercator' });
    m.setSky({
      'sky-color': L.sky.sky,
      'horizon-color': L.sky.horizon,
      'fog-color': L.sky.fog,
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.8,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 5, 0.6, 8, 0],
    });
    paint('ocean', 'background-color', L.ocean);
    paint('land-base', 'fill-color', L.landBase);
    this.waves.configure(layers.waves, L);
    vis('graticule', layers.graticule);
    paint('graticule', 'line-color', L.graticule);

    const reliefOn = layers.relief && mapStyle !== 'plain';
    vis('relief', reliefOn);
    paint('relief', 'raster-brightness-max', L.reliefBrightness);
    paint('relief', 'raster-contrast', L.shade.contrast);
    paint('relief', 'raster-saturation', L.shade.contrast * 0.8);
    for (const id of REGION_FILLS) paint(id, 'fill-opacity', L.fillOpacity);
    vis('region-seam', L.seam);
    vis('height-tint', layers.heightTint && L.tint.strength > 0);
    if (L.tint.strength > 0) paint('height-tint', 'color-relief-color', tintRamp(L.tint));
    const lit = layers.hillshade && L.hillshade;
    vis('hillshade', lit && L.shade.main > 0);
    vis('hillshade-deep', lit && L.shade.deep > 0);
    paint('hillshade', 'hillshade-exaggeration', L.shade.main);
    paint('hillshade', 'hillshade-shadow-color', L.shade.shadow);
    paint('hillshade', 'hillshade-highlight-color', L.shade.highlight);
    paint('hillshade-deep', 'hillshade-exaggeration', L.shade.deep);
    paint('hillshade-deep', 'hillshade-shadow-color', L.shade.shadow);
    vis('veil', L.veil > 0);
    paint('veil', 'fill-opacity', L.veil);
    vis('urban', layers.urban);
    paint('urban', 'fill-color', L.urban);
    paint('lakes', 'fill-color', L.lake);
    vis('rivers', layers.rivers);
    paint('rivers', 'line-color', L.river);
    vis('region-borders', layers.regionBorders);
    paint('region-borders', 'line-color', L.regionBorder);
    paint('coast', 'line-color', L.coast);
    paint('coast-glow', 'line-color', L.coastGlow);
    paint('coast-shadow', 'line-color', L.coastShadow);
    paint('country-borders', 'line-color', L.countryBorder);
    paint('country-borders', 'line-opacity', L.countryBorderOpacity);
    paint('country-borders', 'line-width', ['interpolate', ['exponential', 1.6], ['zoom'], 1, L.countryBorderWidth * 0.7, 4, L.countryBorderWidth * 1.3, 8, L.countryBorderWidth * 2.8]);
    vis('country-borders-casing', mapStyle === 'political' || mapStyle === 'plain');
    for (const id of ['selection', 'selection-regions']) paint(id, 'line-color', L.selection);

    const hasWater = (doc?.water.length ?? 0) > 0;
    vis('water-labels', layers.water && hasWater);
    vis('marine-labels', layers.water && !hasWater);
    paint('water-labels', 'text-color', L.waterLabel);
    paint('marine-labels', 'text-color', L.waterLabel);
    vis('region-labels', layers.regionLabels);
    paint('region-labels', 'text-color', L.regionLabel);
    paint('region-labels', 'text-halo-color', L.labelHalo);
    vis('cities', layers.cities);
    vis('capitals', layers.cities);
    for (const id of ['cities', 'capitals']) {
      paint(id, 'text-color', L.cityLabel);
      paint(id, 'text-halo-color', L.labelHalo);
    }
    vis('country-labels', layers.countryLabels);
    paint('country-labels', 'text-color', L.label);
    paint('country-labels', 'text-halo-color', L.labelHalo);
    m.setLayoutProperty('country-labels', 'icon-image', layers.flags ? ['get', 'flag'] : '');

    for (const id of ['mark-casing', 'mark-solid', 'mark-rail-ties', 'mark-dash', 'mark-dot', 'mark-sel', 'mark-line-labels', 'mark-labels', 'mark-pins']) vis(id, layers.marks);
    vis('occupation', layers.occupation);
    vis('state-borders', layers.stateBorders);
    paint('state-borders', 'line-color', mapStyle === 'night' ? 'rgba(220,225,240,0.5)' : 'rgba(43,43,61,0.55)');
    // Curved names: from the zoom where a name fits its arc it moves there, and its flag stays put.
    vis('country-labels-curved', layers.countryLabels && layers.curvedLabels);
    vis('country-flags', layers.countryLabels && layers.curvedLabels && layers.flags);
    paint('country-labels-curved', 'text-color', L.label);
    paint('country-labels-curved', 'text-halo-color', L.labelHalo);
    const name: ExpressionSpecification = L.labelUpper ? ['upcase', ['get', 'name']] : ['get', 'name'];
    m.setLayoutProperty('country-labels-curved', 'text-field', name);
    m.setLayoutProperty('country-labels', 'text-field', name);
    m.setFilter('country-labels', layers.curvedLabels ? ['<', ['zoom'], ['get', 'zfit']] : null);
    this.syncCurves();

    m.setTerrain(layers.terrain ? { source: 'dem-terrain', exaggeration: 18 } : null);
    this.recolorAll();
  }

  /** Layers of the editor itself (not of the map look): alliance outlines, the rivers and crests the brush stops at. */
  private addOverlays() {
    const m = this.map;
    const before = 'selection-halo';
    m.addSource('alliances', { type: 'geojson', data: fc([]) });
    m.addSource('barriers', { type: 'geojson', data: fc([]) });
    m.addLayer(
      {
        id: 'alliance-casing',
        type: 'line',
        source: 'alliances',
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 3, 6, 7], 'line-opacity': 0.7, 'line-blur': 1 },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      },
      before,
    );
    m.addLayer(
      {
        id: 'alliance-borders',
        type: 'line',
        source: 'alliances',
        paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.6, 6, 3.6] },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      },
      before,
    );
    m.addLayer(
      {
        id: 'barrier-glow',
        type: 'line',
        source: 'barriers',
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 3, 6, 7], 'line-opacity': 0.75, 'line-blur': 1.5 },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      },
      before,
    );
    m.addLayer(
      {
        id: 'barrier-lines',
        type: 'line',
        source: 'barriers',
        paint: {
          'line-color': ['match', ['get', 'kind'], 'crest', '#9a5b2e', '#1f7fd1'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.4, 6, 3],
          'line-dasharray': [3, 1.2],
        },
        layout: { 'line-join': 'round' },
      },
      before,
    );
  }

  /**
   * Shows the active rivers and crests while painting with natural borders on, or while a border
   * is being snapped to them (loading them first).
   */
  private syncBarriers() {
    if (!this.loaded) return;
    const { tool, natural, snap } = get();
    const lines = snap ? snapLines() : natural;
    const on = !!snap || (tool === 'paint' && naturalOn(natural));
    if (on && !barriers()) {
      loadBarriers().then(() => this.syncBarriers(), () => toast('Could not load the rivers and crests', 'error'));
      return;
    }
    const b = barriers();
    this.src('barriers')?.setData(on && b ? (b.geojson(lines) as FeatureCollection) : fc([]));
  }

  /** Outlines of the alliances shown (all of them, or the focused one). */
  private syncAlliances() {
    if (!this.loaded) return;
    const { doc, allianceView } = get();
    const features: Feature[] = [];
    if (doc && allianceView && engine.ready) {
      for (const a of doc.alliances) {
        if (allianceView !== 'all' && a.id !== allianceView) continue;
        const members = new Set(a.members);
        features.push({ type: 'Feature', properties: { color: a.color }, geometry: dropCuts(engine.outline((rid) => members.has(doc.regions[rid]?.cid))) });
      }
    }
    this.src('alliances')?.setData(fc(features));
  }

  // ── Sync ─────────────────────────────────────────────────────────────────

  syncAll() {
    if (!this.loaded) return;
    this.regionColor.clear();
    this.regionLabelKey.clear();
    this.selected.clear();
    this.hovered = null;
    this.syncRegionsData();
    this.recolorAll();
    this.syncBorders();
    this.syncCountryLabels();
    this.syncCities();
    this.syncWater();
    this.syncSelection();
    this.syncAlliances();
    this.syncBarriers();
    this.syncMarks();
    this.syncOccupation();
    this.syncData();
    this.applyLook();
    const v = get().doc?.view;
    if (v) this.map.jumpTo({ center: v.center, zoom: v.zoom, bearing: v.bearing ?? 0, pitch: v.pitch ?? 0 });
  }

  private onChange(c: ChangeSet) {
    if (!this.loaded) return;
    if (c.all) {
      this.syncAll();
      return;
    }
    if (c.geoms) this.syncRegionsData();
    else if (c.regions.size) this.syncRegionLabels();
    const doc = get().doc!;
    for (const id of c.regions) {
      if (!doc.regions[id]) {
        this.regionColor.delete(id);
        this.map.removeFeatureState({ source: 'regions', id });
      }
    }
    this.recolor(c.regions, c.countries);
    if (c.geoms) this.syncBorders();
    else if (c.regions.size || c.countries.size) this.scheduleBorders();
    if (c.countries.size || c.regions.size) this.scheduleLabels();
    if (c.cities) this.syncCities();
    if (c.marks) this.syncMarks();
    if (c.regions.size || c.geoms) this.scheduleOccupation();
    if (c.alliances) this.recolorAll();
    // Thematic colours depend on every country's figures: recolour all when any changes.
    if (this.thematicOn() && (c.countries.size || c.regions.size)) this.recolorAll();
    if (get().allianceView && (c.alliances || c.geoms || c.regions.size)) this.scheduleAlliances();
    this.syncSelection();
  }

  private allianceTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduleAlliances() {
    if (this.allianceTimer) return;
    this.allianceTimer = setTimeout(() => {
      this.allianceTimer = null;
      this.syncAlliances();
    }, 150);
  }

  private syncRegionsData() {
    const { doc, geoms } = get();
    if (!doc) return;
    const features: Feature[] = [];
    for (const [id, g] of Object.entries(geoms)) {
      if (doc.regions[Number(id)]) features.push({ type: 'Feature', id: Number(id), properties: { polar: touchesPole(g) }, geometry: g });
    }
    this.src('regions')?.setData(fc(features));
    this.regionLabelKey.clear();
    this.syncRegionLabels();
  }

  private syncRegionLabels() {
    const doc = get().doc;
    if (!doc) return;
    let dirty = this.regionLabelKey.size !== Object.keys(doc.regions).length;
    if (!dirty) {
      for (const r of Object.values(doc.regions)) {
        if (this.regionLabelKey.get(r.id) !== `${r.name}|${r.cx}|${r.cy}`) {
          dirty = true;
          break;
        }
      }
    }
    if (!dirty) return;
    this.regionLabelKey.clear();
    const features: Feature<Point>[] = Object.values(doc.regions).map((r) => {
      this.regionLabelKey.set(r.id, `${r.name}|${r.cx}|${r.cy}`);
      return { type: 'Feature', id: r.id, properties: { name: r.name, area: r.area }, geometry: { type: 'Point', coordinates: [r.cx, r.cy] } };
    });
    this.src('region-labels')?.setData(fc(features));
  }

  private thematicOn() {
    return !!get().thematic && !get().allianceView;
  }

  private colorOf(cid: string, r?: Region): string {
    const { doc, mapStyle, allianceView } = get();
    const c = doc?.countries[cid];
    if (c && doc && this.thematicOn() && this.thematic) {
      return (r && this.thematic.regionColor?.(r)) || this.thematic.colors[cid] || mute(c.color, mapStyle === 'night');
    }
    if (c && allianceView && doc) {
      // Alliance view: members take their alliance's colour, everyone else fades to grey.
      const a = doc.alliances.find((x) => (allianceView === 'all' || x.id === allianceView) && x.members.includes(cid));
      return a ? a.color : mute(c.color, mapStyle === 'night');
    }
    if (c) return c.color;
    const u = LOOKS[mapStyle].unclaimed;
    return u ?? 'rgba(0,0,0,0)';
  }

  private setColor(id: number, color: string) {
    if (this.regionColor.get(id) === color) return;
    this.regionColor.set(id, color);
    this.map.setFeatureState({ source: 'regions', id }, { color });
  }

  private recolorAll() {
    const { doc, thematic } = get();
    if (!doc || !this.loaded) return;
    this.thematic = thematic && this.thematicOn() ? computeThematic(doc, thematic) : null;
    for (const r of Object.values(doc.regions)) this.setColor(r.id, this.colorOf(r.cid, r));
  }

  private recolor(regionIds: Set<number>, countries: Set<string>) {
    const doc = get().doc!;
    for (const id of regionIds) {
      const r = doc.regions[id];
      if (r) this.setColor(id, this.colorOf(r.cid, r));
    }
    if (countries.size) {
      for (const r of Object.values(doc.regions)) if (countries.has(r.cid)) this.setColor(r.id, this.colorOf(r.cid, r));
    }
  }

  /** Borders are recomputed at most every ~120 ms while painting. */
  private scheduleBorders() {
    if (this.borderTimer) return;
    const wait = Math.max(0, 120 - (performance.now() - this.lastBorderRun));
    this.borderTimer = setTimeout(() => {
      this.borderTimer = null;
      this.syncBorders();
    }, wait);
  }

  private syncBorders() {
    const doc = get().doc;
    if (!doc || !engine.ready) return;
    this.lastBorderRun = performance.now();
    const regions = doc.regions;
    const b = engine.borders((rid) => regions[rid]?.cid ?? '');
    const asFc = (g: typeof b.coast) => fc([{ type: 'Feature', properties: {}, geometry: dropCuts(g) }]);
    this.src('borders-country')?.setData(asFc(b.countries));
    this.src('borders-region')?.setData(asFc(b.regions));
    this.src('coast')?.setData(asFc(b.coast));
    // Borders between the states of a country (country borders are drawn over the rest).
    const anyStates = Object.values(doc.countries).some((c) => c.states && Object.keys(c.states).length);
    if (anyStates) {
      const st = engine.borders((rid) => (regions[rid] ? `${regions[rid].cid}|${regions[rid].state ?? ''}` : ''));
      this.src('borders-state')?.setData(asFc(st.countries));
    } else this.src('borders-state')?.setData(fc([]));
  }

  private scheduleLabels() {
    if (this.labelTimer) return;
    this.labelTimer = setTimeout(() => {
      this.labelTimer = null;
      this.syncCountryLabels();
    }, 150);
  }

  syncCountryLabels() {
    const doc = get().doc;
    if (!doc) return;
    const agg = countryAggregates(doc);
    const features: Feature<Point>[] = [];
    for (const c of Object.values(doc.countries)) {
      const a = agg[c.cid];
      if (!a?.regions || !c.label) continue;
      const s = Math.min(1, Math.max(0, (Math.log10(Math.max(a.area, 1)) - 3.3) / 3.6));
      features.push({
        type: 'Feature',
        properties: {
          cid: c.cid,
          name: c.name,
          s: +s.toFixed(3),
          flag: this.flagImage(c),
          // From this zoom the name follows its arc (and only the flag stays here).
          zfit: this.dragging?.kind === 'label' && this.dragging.cid === c.cid ? 99 : this.curved.get(c.cid) ?? 99,
        },
        geometry: { type: 'Point', coordinates: this.dragging?.kind === 'label' && this.dragging.cid === c.cid && this.dragging.at ? this.dragging.at : c.label },
      });
    }
    this.src('country-labels')?.setData(fc(features));
    if (get().layers.curvedLabels && !this.inCurves) this.syncCurves();
  }

  /** Countries whose name follows an arc, with the zoom from which the name fits along it. */
  private curved = new Map<string, number>();
  private curveCache = new Map<string, { key: string; line: ReturnType<typeof countryCurve> }>();
  private inCurves = false;

  private syncCurves() {
    const { doc, layers } = get();
    if (!doc || !this.loaded) return;
    const before = [...this.curved].sort().join();
    const upper = !!LOOKS[get().mapStyle].labelUpper;
    this.curved.clear();
    const features: Feature[] = [];
    if (layers.curvedLabels && layers.countryLabels && engine.ready) {
      const agg = countryAggregates(doc);
      for (const c of Object.values(doc.countries)) {
        const a = agg[c.cid];
        if (!a?.regions || a.area < 20000) continue;
        const key = `${a.area.toFixed(0)}|${a.regions}|${c.labelFixed ? c.label?.join() : ''}|${engine.version}`;
        let hit = this.curveCache.get(c.cid);
        if (!hit || hit.key !== key) {
          hit = { key, line: countryCurve(engine.merge(mainBody(c.cid)), c.labelFixed ? c.label : undefined) };
          this.curveCache.set(c.cid, hit);
        }
        if (!hit.line) continue;
        const s = Math.min(1, Math.max(0, (Math.log10(Math.max(a.area, 1)) - 3.3) / 3.6));
        const zfit = fitZoom(hit.line.coordinates as LngLat[], c.name.length, s, upper);
        if (zfit == null) continue;
        this.curved.set(c.cid, zfit);
        features.push({ type: 'Feature', properties: { cid: c.cid, name: c.name, s: +s.toFixed(3), zfit }, geometry: hit.line });
      }
    }
    this.src('country-curves')?.setData(fc(features));
    if ([...this.curved].sort().join() !== before) {
      this.inCurves = true;
      this.syncCountryLabels();
      this.inCurves = false;
    }
  }

  // ── Marks, occupation, data layers ────────────────────────────────────────

  private syncMarks() {
    const { doc, markSel } = get();
    if (!doc || !this.loaded) return;
    const features: Feature[] = [];
    for (const m of Object.values(doc.marks ?? {})) {
      const at: LngLat | null = this.dragging?.kind === 'mark' && this.dragging.id === m.id ? this.dragging.at : null;
      if (m.type === 'line') {
        if (m.coords.length < 2) continue;
        features.push({ type: 'Feature', properties: { id: m.id, type: 'line', kind: m.kind, name: m.name, color: m.color, sel: m.id === markSel }, geometry: { type: 'LineString', coordinates: m.coords } });
      } else if (m.type === 'label') {
        features.push({
          type: 'Feature',
          properties: { id: m.id, type: 'label', kind: m.kind, text: m.text, size: m.size, angle: m.angle, color: m.color ?? null, sel: m.id === markSel },
          geometry: { type: 'Point', coordinates: at ?? [m.lng, m.lat] },
        });
      } else {
        const icon = this.ensurePin(m);
        features.push({
          type: 'Feature',
          properties: { id: m.id, type: 'pin', name: m.name, icon, sel: m.id === markSel },
          geometry: { type: 'Point', coordinates: at ?? [m.lng, m.lat] },
        });
      }
    }
    this.src('marks')?.setData(fc(features));
  }

  /** The pin's image (made on first use); returns the part after "pin-". */
  private ensurePin(m: Extract<Mark, { type: 'pin' }>): string {
    const key = m.color ? `${m.icon}:${m.color}` : m.icon;
    if (!this.map.hasImage(`pin-${key}`)) this.map.addImage(`pin-${key}`, drawPin(m.icon, m.color), { pixelRatio: 2 });
    return key;
  }

  private occTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduleOccupation() {
    if (this.occTimer) return;
    this.occTimer = setTimeout(() => {
      this.occTimer = null;
      this.syncOccupation();
    }, 150);
  }

  private syncOccupation() {
    const { doc, geoms } = get();
    if (!doc || !this.loaded) return;
    const features: Feature[] = [];
    for (const r of Object.values(doc.regions)) {
      if (!r.occ || !geoms[r.id]) continue;
      const color = doc.countries[r.occ]?.color ?? '#888888';
      features.push({ type: 'Feature', properties: { pat: this.hatch(color) }, geometry: geoms[r.id] });
    }
    this.src('occupied')?.setData(fc(features));
  }

  /** Diagonal stripes in `color`, as a fill pattern. */
  private hatch(color: string): string {
    const id = `hatch:${color}`;
    if (this.map.hasImage(id)) return id;
    const n = 16;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const ctx = c.getContext('2d')!;
    const stripes = (style: string, width: number, dx: number) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      for (const o of [-n, 0, n]) {
        ctx.beginPath();
        ctx.moveTo(o + dx, n);
        ctx.lineTo(o + n + dx, 0);
        ctx.stroke();
      }
    };
    stripes(color, 4.5, 0);
    // A thin dark edge keeps light stripes readable on light land.
    stripes('rgba(0,0,0,0.22)', 1, 2.6);
    this.map.addImage(id, ctx.getImageData(0, 0, n, n), { pixelRatio: 2 });
    return id;
  }

  private syncData() {
    if (!this.loaded) return;
    syncOverlays(this.map, get().doc?.overlays ?? [], (o) => toast(`Could not load ${o.name} (offline?)`, 'error'));
  }

  private syncCities() {
    const doc = get().doc;
    if (!doc) return;
    const features: Feature<Point>[] = Object.values(doc.cities).map((c) => ({
      type: 'Feature',
      id: c.id,
      properties: { id: c.id, name: c.name, capital: c.capital, hidden: !!c.hidden, pop: c.pop ?? 0 },
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
    }));
    this.src('cities')?.setData(fc(features));
  }

  private syncWater() {
    const doc = get().doc;
    if (!doc) return;
    const rank = (n: string) => (/oc[eé]an/i.test(n) ? 0 : /^(mer|sea|golfe|gulf|baie|bay|canal|manche|détroit|strait|passage)\b|\b(sea|gulf|bay|mer|golfe)\b/i.test(n) ? 1 : 2);
    const features: Feature<Point>[] = doc.water.map((w) => ({
      type: 'Feature',
      properties: { name: w.name, rank: rank(w.name) },
      geometry: { type: 'Point', coordinates: [w.lng, w.lat] },
    }));
    this.src('water')?.setData(fc(features));
  }

  syncSelection() {
    if (!this.loaded) return;
    const { selection, doc } = get();
    if (!doc) return;
    const nextSel = new Set(selection.regions);
    for (const id of this.selected) if (!nextSel.has(id)) this.map.setFeatureState({ source: 'regions', id }, { sel: false });
    for (const id of nextSel) if (!this.selected.has(id)) this.map.setFeatureState({ source: 'regions', id }, { sel: true });
    this.selected = nextSel;
    const features: Feature[] = [];
    if (selection.cid && engine.ready) {
      const cid = selection.cid;
      features.push({ type: 'Feature', properties: { kind: 'country' }, geometry: dropCuts(engine.outline((rid) => doc.regions[rid]?.cid === cid)) });
    }
    if (selection.regions.length && engine.ready) {
      features.push({ type: 'Feature', properties: { kind: 'region' }, geometry: dropCuts(engine.outline((rid) => nextSel.has(rid))) });
    }
    this.src('selection')?.setData(fc(features));
  }

  // ── Images ───────────────────────────────────────────────────────────────

  private addIcons() {
    const make = (size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d')!;
      draw(ctx, size);
      return ctx.getImageData(0, 0, size, size);
    };
    this.map.addImage(
      'city-dot',
      make(20, (ctx, s) => {
        ctx.beginPath();
        ctx.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#2a3142';
        ctx.stroke();
      }),
      { pixelRatio: 2 },
    );
    this.map.addImage(
      'city-capital',
      make(30, (ctx, s) => {
        ctx.beginPath();
        ctx.arc(s / 2, s / 2, s / 2 - 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#2a3142';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(s / 2, s / 2, s / 2 - 9, 0, Math.PI * 2);
        ctx.fillStyle = '#c0283c';
        ctx.fill();
      }),
      { pixelRatio: 2 },
    );
  }

  /** Image id for a country's flag, loading it in the background when needed ('' until ready). */
  private flagImage(c: Country): string {
    const s = get();
    let key: string | null = null;
    let url: string | null = null;
    if (c.flag && s.flagUrls[c.flag]) {
      key = `flag:${c.flag}`;
      url = s.flagUrls[c.flag];
    } else if (iso2[c.cid]) {
      key = `flag:iso-${iso2[c.cid]}`;
      url = asset(`flags/${iso2[c.cid]}.png`);
    }
    if (!key || !url) return '';
    const st = this.flagImages.get(key);
    if (st === 'ready') return key;
    if (!st) {
      this.flagImages.set(key, 'loading');
      this.loadFlag(key, url);
    }
    return '';
  }

  private async loadFlag(key: string, url: string) {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      await img.decode();
      const shape = measureImage(img);
      const H = 44;
      // Any proportions, from a square to a long pennant.
      const W = Math.round(Math.min(104, Math.max(34, shape.ratio * H)));
      const pad = shape.shaped ? 5 : 3;
      const canvas = document.createElement('canvas');
      canvas.width = W + pad * 2;
      canvas.height = H + pad * 2;
      const ctx = canvas.getContext('2d')!;
      if (shape.shaped) {
        // Not a rectangle: no frame, a soft shadow that follows the outline.
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 1;
        ctx.drawImage(img, pad, pad, W, H);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        roundRect(ctx, pad - 1, pad, W + 2, H + 2, 5);
        ctx.fill();
        ctx.save();
        roundRect(ctx, pad, pad, W, H, 4);
        ctx.clip();
        ctx.drawImage(img, pad, pad, W, H);
        ctx.restore();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        roundRect(ctx, pad, pad, W, H, 4);
        ctx.stroke();
      }
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (this.map.hasImage(key)) this.map.removeImage(key);
      this.map.addImage(key, data, { pixelRatio: 2 });
      this.flagImages.set(key, 'ready');
      this.scheduleLabels();
    } catch {
      this.flagImages.set(key, 'failed');
    }
  }

  // ── Interactions ─────────────────────────────────────────────────────────

  private regionAtPoint(p: PointLike): number | null {
    const f = this.map.queryRenderedFeatures(p, { layers: REGION_FILLS })[0];
    return f?.id != null ? Number(f.id) : null;
  }

  private cityAtPoint(p: { x: number; y: number }): number | null {
    const box: [PointLike, PointLike] = [
      [p.x - 6, p.y - 6],
      [p.x + 6, p.y + 6],
    ];
    const layers = ['capitals', 'cities'].filter((l) => this.map.getLayoutProperty(l, 'visibility') !== 'none');
    const f = this.map.queryRenderedFeatures(box, { layers })[0];
    return f ? Number(f.properties.id) : null;
  }

  /** The hand-drawn mark under the pointer (lines get a few pixels of slack). */
  private markAtPoint(p: { x: number; y: number }, pad = 5): string | null {
    if (!get().layers.marks) return null;
    const box: [PointLike, PointLike] = [
      [p.x - pad, p.y - pad],
      [p.x + pad, p.y + pad],
    ];
    const layers = MARK_LAYERS.filter((l) => this.map.getLayer(l));
    const f = this.map.queryRenderedFeatures(box, { layers })[0];
    return f ? String(f.properties.id) : null;
  }

  /** The country whose name is under the pointer. */
  private labelAtPoint(p: { x: number; y: number }): string | null {
    if (!get().layers.countryLabels) return null;
    const layers = LABEL_LAYERS.filter((l) => this.map.getLayer(l) && this.map.getLayoutProperty(l, 'visibility') !== 'none');
    const f = this.map.queryRenderedFeatures([p.x, p.y], { layers })[0];
    return f ? String(f.properties.cid) : null;
  }

  /** Name of the data-layer feature under the pointer, for the hover tip. */
  private overlayTextAt(p: { x: number; y: number }): string | undefined {
    const ids = overlayLayerIds(get().doc?.overlays ?? []).filter((x) => this.map.getLayer(x.layer));
    if (!ids.length) return undefined;
    const box: [PointLike, PointLike] = [
      [p.x - 4, p.y - 4],
      [p.x + 4, p.y + 4],
    ];
    const f = this.map.queryRenderedFeatures(box, { layers: ids.map((x) => x.layer) })[0];
    if (!f) return undefined;
    const o = ids.find((x) => x.layer === f.layer.id)?.o;
    const v = o?.label ? f.properties[o.label] : undefined;
    if (o?.id === 'quakes') return `M${f.properties.mag} · ${v}`;
    return v ? `${v} · ${o!.name}` : undefined;
  }

  private setHover(region: number | null) {
    if (region === this.hovered) return;
    if (this.hovered != null) this.map.setFeatureState({ source: 'regions', id: this.hovered }, { hover: false });
    if (region != null) this.map.setFeatureState({ source: 'regions', id: region }, { hover: true });
    this.hovered = region;
  }

  private bindInteractions() {
    const m = this.map;
    m.doubleClickZoom.disable();
    m.on('mousemove', (e) => this.onMove(e));
    m.on('mouseout', () => {
      this.setHover(null);
      this.onHover?.(null);
      this.onBrush?.(null);
    });
    m.on('click', (e) => this.onClick(e));
    m.on('dblclick', (e) => this.onDblClick(e));
    m.on('mousedown', (e) => this.onDown(e));
    m.on('touchstart', (e) => {
      if (e.points.length === 1) this.onDown(e as unknown as MapMouseEvent);
    });
    m.on('mouseup', () => this.onUp());
    m.on('touchend', () => this.onUp());
    m.on('touchmove', (e) => {
      if (this.lasso && e.points.length === 1) this.extendLasso(e as unknown as MapMouseEvent);
      else if (this.stroke && e.points.length === 1) {
        this.paintTo(e.point.x, e.point.y);
        // Phones have no hover: show the brush under the finger, red when a river or crest stops it.
        this.onBrush?.({ x: e.point.x, y: e.point.y, r: get().brushSize, blocked: !!this.stroke?.blockedAt });
      }
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private pressed: { x: number; y: number; cid?: string; mark?: string } | null = null;

  private onMove(e: MapMouseEvent) {
    if (this.lasso) return this.extendLasso(e);
    if (this.pressed && !this.dragging && Math.hypot(e.point.x - this.pressed.x, e.point.y - this.pressed.y) > 4) {
      // A press on a name or a mark that moves: drag it.
      if (this.pressed.mark) this.dragging = { kind: 'mark', id: this.pressed.mark, at: null };
      else if (this.pressed.cid) this.dragging = { kind: 'label', cid: this.pressed.cid, at: null };
      if (this.dragging) this.map.dragPan.disable();
    }
    if (this.dragging) {
      this.dragging.at = [e.lngLat.lng, e.lngLat.lat];
      this.map.getCanvas().style.cursor = 'grabbing';
      if (this.dragging.kind === 'mark') this.syncMarks();
      else this.syncCountryLabels();
      return;
    }
    if (get().snap?.drawing) {
      this.map.getCanvas().style.cursor = 'crosshair';
      return;
    }
    const { tool } = get();
    if (tool === 'paint') this.onBrush?.({ x: e.point.x, y: e.point.y, r: get().brushSize, blocked: !!this.stroke?.blockedAt });
    if (this.stroke) {
      this.paintTo(e.point.x, e.point.y);
      return;
    }
    if (this.draggingCity != null) {
      const c = get().doc?.cities[this.draggingCity];
      if (c) {
        const feats = (this.src('cities') as GeoJSONSource);
        const doc = get().doc!;
        feats.setData(
          fc(
            Object.values(doc.cities).map((x) => ({
              type: 'Feature',
              properties: { id: x.id, name: x.name, capital: x.capital, hidden: !!x.hidden, pop: x.pop ?? 0 },
              geometry: { type: 'Point', coordinates: x.id === c.id ? [e.lngLat.lng, e.lngLat.lat] : [x.lng, x.lat] },
            })),
          ),
        );
      }
      return;
    }
    if ((tool === 'split' || tool === 'draw') && this.drawPts.length) {
      this.renderDraw([e.lngLat.lng, e.lngLat.lat]);
    }
    const mark = tool === 'select' ? this.markAtPoint(e.point) : null;
    const label = tool === 'select' && !mark ? this.labelAtPoint(e.point) : null;
    const city = tool !== 'paint' && tool !== 'draw' && !mark ? this.cityAtPoint(e.point) : null;
    const region = city == null && !mark ? this.regionAtPoint(e.point) : null;
    this.setHover(tool === 'split' || tool === 'draw' || mark || label ? null : region);
    this.map.getCanvas().style.cursor =
      tool === 'select' ? (mark || label ? 'move' : city != null || region != null ? 'pointer' : '') : tool === 'city' ? (city != null ? 'move' : 'copy') : 'crosshair';
    const m = mark ? get().doc?.marks?.[mark] : null;
    const text = m ? (m.type === 'label' ? m.text : m.name || LINE_KINDS[m.type === 'line' ? m.kind : 'road'].label) : this.overlayTextAt(e.point);
    this.onHover?.({ x: e.point.x, y: e.point.y, region: m ? null : region, city: m ? null : city, text });
  }

  private onClick(e: MapMouseEvent) {
    const { tool, doc, selection } = get();
    if (!doc || get().snap?.drawing) return;
    const oe = e.originalEvent as MouseEvent;
    if (this.dragJustEnded) {
      this.dragJustEnded = false;
      return;
    }
    if (tool === 'select') {
      const mark = this.markAtPoint(e.point);
      if (mark) {
        select({});
        useWorld.setState({ markSel: mark });
        return;
      }
      if (get().markSel) useWorld.setState({ markSel: null });
      const city = this.cityAtPoint(e.point);
      if (city != null) {
        const c = doc.cities[city];
        select({ city, anchor: [c.lng, c.lat] });
        this.centerOn([c.lng, c.lat]);
        return;
      }
      const rid = this.regionAtPoint(e.point);
      if (rid == null) {
        // A country's name (or flag) over the sea: that country.
        const cid = this.labelAtPoint(e.point);
        if (cid && doc.countries[cid]) select({ cid, anchor: doc.countries[cid].label });
        else select({});
        return;
      }
      const r = doc.regions[rid];
      const anchor: LngLat = [e.lngLat.lng, e.lngLat.lat];
      if (oe.shiftKey || oe.ctrlKey || oe.metaKey || get().multiSelect) {
        // Picking several regions: the map stays still under the finger.
        const ids = selection.regions.includes(rid) ? selection.regions.filter((x) => x !== rid) : [...selection.regions, rid];
        select({ cid: selection.cid ?? (r.cid || null), regions: ids, anchor });
        return;
      } else if (selection.regions.length === 1 && selection.regions[0] === rid) {
        // Second click on the same region: back to the whole country.
        select({ cid: r.cid || null, regions: [], anchor });
      } else {
        select({ cid: r.cid || null, regions: [rid], anchor });
      }
      this.centerOn(anchor);
    } else if (tool === 'split') {
      this.drawPts.push([e.lngLat.lng, e.lngLat.lat]);
      this.renderDraw();
    } else if (tool === 'draw') {
      const at: LngLat = [+e.lngLat.lng.toFixed(4), +e.lngLat.lat.toFixed(4)];
      const kind = get().drawKind;
      if (kind === 'label') {
        const k = 'land' as const;
        const id = addMark({ id: newMarkId(), type: 'label', kind: k, text: 'New name', lng: at[0], lat: at[1], size: LABEL_KINDS[k].size, angle: 0 }, 'Place a name');
        useWorld.setState({ markSel: id, detailsOpen: true });
      } else if (kind === 'pin') {
        const id = addMark({ id: newMarkId(), type: 'pin', name: 'New place', icon: 'star', lng: at[0], lat: at[1] }, 'Place a pin');
        useWorld.setState({ markSel: id, detailsOpen: true });
      } else {
        this.drawPts.push(at);
        this.renderDraw();
      }
    } else if (tool === 'city') {
      if (this.cityAtPoint(e.point) != null) return;
      const id = addCity(+e.lngLat.lng.toFixed(4), +e.lngLat.lat.toFixed(4));
      select({ city: id });
    }
  }

  private onDblClick(e: MapMouseEvent) {
    const { tool } = get();
    if (tool === 'split') {
      // The dblclick's two clicks already added the final point (twice).
      this.drawPts.pop();
      this.finishSplit();
    } else if (tool === 'draw' && this.drawPts.length) {
      this.drawPts.pop();
      this.finishDraw();
    } else if (tool === 'select') {
      const rid = this.regionAtPoint(e.point);
      if (rid != null) this.map.easeTo({ center: e.lngLat, zoom: this.map.getZoom() + 1.2, duration: 450 });
    }
  }

  private onDown(e: MapMouseEvent) {
    const { tool, doc, brushCid } = get();
    if (!doc) return;
    const oe = e.originalEvent as MouseEvent;
    if (oe && 'button' in oe && oe.button !== 0) return;
    if (get().snap?.drawing) {
      e.preventDefault();
      this.lasso = { pts: [[e.lngLat.lng, e.lngLat.lat]], last: [e.point.x, e.point.y] };
      this.renderLasso();
      return;
    }
    if (tool === 'paint' && !this.spaceDown) {
      const mode = get().brushMode;
      if (oe?.altKey || mode === 'pick') {
        // Eyedropper
        const rid = this.regionAtPoint(e.point);
        if (rid != null) {
          useWorld.setState({ brushCid: doc.regions[rid].cid });
          toast(`Brush: ${doc.countries[doc.regions[rid].cid]?.name ?? 'Unclaimed'}`);
          if (mode === 'pick') useWorld.setState({ brushMode: 'paint' });
        }
        e.preventDefault();
        return;
      }
      if (brushCid && !doc.countries[brushCid]) {
        toast('Pick a country to paint with first', 'error');
        return;
      }
      e.preventDefault();
      const natural = activeNatural();
      this.stroke = { group: `paint:${Date.now()}`, last: [e.point.x, e.point.y], anchor: natural ? [e.lngLat.lng, e.lngLat.lat] : null };
      if (oe?.ctrlKey || oe?.metaKey || mode === 'whole') {
        if (natural) {
          // The country under the cursor, up to its rivers and crests.
          const n = claimUpToNature([e.lngLat.lng, e.lngLat.lat], brushCid, { group: this.stroke.group, label: `Paint ${doc.countries[brushCid]?.name ?? 'unclaimed'}` });
          if (!n) toast('Nothing to take here');
          return;
        }
        // Whole-country fill: annex the entire country under the cursor.
        const rid = this.regionAtPoint(e.point);
        const src = rid != null ? doc.regions[rid].cid : null;
        if (src != null && src !== brushCid) {
          const ids = Object.values(doc.regions)
            .filter((r) => r.cid === src)
            .map((r) => r.id);
          transferRegions(ids, brushCid, { group: this.stroke.group, label: `Paint ${doc.countries[brushCid]?.name ?? 'unclaimed'}` });
        }
        return;
      }
      this.paintAt(e.point.x, e.point.y);
    } else if (tool === 'select') {
      // Names and pins can be dragged: remember what was pressed, the drag starts once it moves.
      const mark = this.markAtPoint(e.point, 2);
      const m = mark ? doc.marks?.[mark] : null;
      if (m && m.type !== 'line') this.pressed = { x: e.point.x, y: e.point.y, mark: m.id };
      else if (!mark) {
        const cid = this.labelAtPoint(e.point);
        if (cid) this.pressed = { x: e.point.x, y: e.point.y, cid };
      }
      if (this.pressed) e.preventDefault();
    } else if (tool === 'city') {
      const city = this.cityAtPoint(e.point);
      if (city != null) {
        e.preventDefault();
        this.draggingCity = city;
        this.map.dragPan.disable();
        select({ city });
      }
    }
  }

  private dragJustEnded = false;

  private onUp() {
    this.pressed = null;
    if (this.dragging) {
      const d = this.dragging;
      this.dragging = null;
      this.map.dragPan.enable();
      this.dragJustEnded = true;
      // The click that ends a drag is ignored; it may not come at all (touch), so reset soon.
      setTimeout(() => (this.dragJustEnded = false), 50);
      if (d.at && d.kind === 'label') moveLabel(d.cid, d.at);
      else if (d.at && d.kind === 'mark') updateMark(d.id, { lng: +d.at[0].toFixed(4), lat: +d.at[1].toFixed(4) }, 'Move');
      else if (d.kind === 'mark') this.syncMarks();
      else this.syncCountryLabels();
      return;
    }
    if (this.lasso) {
      const pts = this.lasso.pts;
      this.cancelLasso();
      finishSnapLasso(pts);
      return;
    }
    if (this.stroke) {
      this.stroke = null;
      endGroup();
      this.onBrush?.(null);
    }
    if (this.draggingCity != null) {
      const id = this.draggingCity;
      this.draggingCity = null;
      this.map.dragPan.enable();
      const f = this.map.querySourceFeatures('cities').find((x) => Number(x.properties.id) === id);
      const pt = f?.geometry.type === 'Point' ? (f.geometry.coordinates as LngLat) : null;
      if (pt) updateCity(id, { lng: +pt[0].toFixed(4), lat: +pt[1].toFixed(4) }, 'Move city');
      else this.syncCities();
    }
  }

  private paintTo(x: number, y: number) {
    if (!this.stroke) return;
    const [lx, ly] = this.stroke.last;
    const r = Math.max(4, get().brushSize);
    const d = Math.hypot(x - lx, y - ly);
    const steps = Math.max(1, Math.ceil(d / r));
    for (let i = 1; i <= steps; i++) this.paintAt(lx + ((x - lx) * i) / steps, ly + ((y - ly) * i) / steps);
    this.stroke.last = [x, y];
  }

  private paintAt(x: number, y: number) {
    const { brushSize, brushCid, doc } = get();
    if (!doc || !this.stroke) return;
    const r = brushSize;
    const q: PointLike | [PointLike, PointLike] = r > 0 ? [[x - r, y - r], [x + r, y + r]] : [x, y];
    const feats = this.map.queryRenderedFeatures(q, { layers: REGION_FILLS });
    const ids = new Set<number>();
    for (const f of feats) if (f.id != null && doc.regions[Number(f.id)]?.cid !== brushCid) ids.add(Number(f.id));
    const opts = { group: this.stroke.group, label: `Paint ${doc.countries[brushCid]?.name ?? 'unclaimed'}`, deferLabels: true };
    if (this.stroke.anchor) {
      // Natural borders: the brush never reaches across a river or crest from where the stroke is.
      const at = this.map.unproject([x, y]);
      const p: LngLat = [at.lng, at.lat];
      if (blocked(this.stroke.anchor, p)) {
        this.stroke.blockedAt = p;
        return;
      }
      this.stroke.anchor = p;
      this.stroke.blockedAt = undefined;
      if (!ids.size) return;
      const samples: LngLat[] = [];
      if (r > 0)
        for (const k of [0.5, 1])
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const s = this.map.unproject([x + Math.cos(a) * r * k, y + Math.sin(a) * r * k]);
            samples.push([s.lng, s.lat]);
          }
      // What the map has drawn can lag a cut by a frame or two: look the regions up in the data too.
      if (r > 0) {
        const xs = samples.map((q) => q[0]);
        const ys = samples.map((q) => q[1]);
        for (const id of regionsInBox([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)])) if (doc.regions[id] && doc.regions[id].cid !== brushCid) ids.add(id);
      } else {
        const under = regionAt(p);
        if (under && under.cid !== brushCid) ids.add(under.id);
      }
      for (const id of [...ids]) if (!get().doc!.regions[id]) ids.delete(id);
      // Regions a river or crest runs through are cut along it first, then only this side is taken.
      const pieces = cutAlongNature([...ids], { group: this.stroke.group }).filter((id) => get().doc!.regions[id]?.cid !== brushCid);
      // The outer ring of samples outlines the dab, for pieces too thin to hold a sample.
      const take = reachable(p, samples, pieces, r > 0 ? samples.slice(8) : undefined);
      if (take.length) transferRegions(take, brushCid, opts);
      return;
    }
    if (ids.size) transferRegions([...ids], brushCid, opts);
  }

  private extendLasso(e: MapMouseEvent) {
    const l = this.lasso;
    if (!l) return;
    if (Math.hypot(e.point.x - l.last[0], e.point.y - l.last[1]) < 5) return;
    l.pts.push([e.lngLat.lng, e.lngLat.lat]);
    l.last = [e.point.x, e.point.y];
    this.renderLasso();
  }

  /** The loop so far, closed back to where it started. */
  private renderLasso() {
    const pts = this.lasso?.pts ?? [];
    this.src('draw')?.setData(fc(pts.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [...pts, pts[0]] } }] : []));
  }

  private cancelLasso() {
    if (!this.lasso) return;
    this.lasso = null;
    this.src('draw')?.setData(fc([]));
  }

  private renderDraw(cursor?: LngLat) {
    const pts = cursor ? [...this.drawPts, cursor] : this.drawPts;
    const features: Feature[] = this.drawPts.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }));
    const land = get().tool === 'draw' && get().drawKind === 'land';
    if (land && pts.length > 2) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] } });
    else if (pts.length > 1) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } });
    this.src('draw')?.setData(fc(features));
    this.onDrawChange?.(this.drawPts.length);
  }

  cancelDraw() {
    this.drawPts = [];
    this.renderDraw();
  }

  finishSplit() {
    const pts = this.drawPts;
    this.cancelDraw();
    if (pts.length < 2) return;
    const sel = get().selection.regions;
    const n = splitAlong(pts, sel.length ? sel : undefined);
    if (n) toast(`Split ${n} region${n > 1 ? 's' : ''}`, 'ok');
    else toast('The line has to cross a region from side to side', 'error');
  }

  /** Ends the outline or line being drawn with the Draw tool. */
  finishDraw() {
    const pts = this.drawPts;
    this.cancelDraw();
    const kind = get().drawKind;
    if (kind === 'land') {
      if (pts.length < 3) return toast('Click at least three points around the new land', 'error');
      if (addLand(pts, get().landCid) != null) toast('New land raised', 'ok');
    } else if (kind !== 'label' && kind !== 'pin') {
      if (pts.length < 2) return;
      const id = addMark({ id: newMarkId(), type: 'line', kind, name: '', color: LINE_KINDS[kind].color, coords: pts });
      useWorld.setState({ markSel: id });
    }
  }

  undoDrawPoint() {
    this.drawPts.pop();
    this.renderDraw();
  }

  private onToolChange(s: State, p: State) {
    if (p.tool === 'split' || p.tool === 'draw') this.cancelDraw();
    if (s.tool !== 'paint') this.onBrush?.(null);
    if (s.tool === 'paint') this.map.dragPan.disable();
    else this.map.dragPan.enable();
    this.setHover(null);
    this.map.getCanvas().style.cursor = s.tool === 'select' ? '' : 'crosshair';
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' && get().tool === 'paint' && !this.spaceDown && !isTyping(e)) {
      this.spaceDown = true;
      this.map.dragPan.enable();
      this.map.getCanvas().style.cursor = 'grab';
      e.preventDefault();
    }
    if (get().tool === 'draw' && !isTyping(e)) {
      if (e.key === 'Enter') this.finishDraw();
      else if (e.key === 'Escape') this.cancelDraw();
      else if (e.key === 'Backspace') this.undoDrawPoint();
    }
    if (get().tool === 'split' && !isTyping(e)) {
      if (e.key === 'Enter') this.finishSplit();
      else if (e.key === 'Escape') this.cancelDraw();
      else if (e.key === 'Backspace') this.undoDrawPoint();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space' && this.spaceDown) {
      this.spaceDown = false;
      if (get().tool === 'paint') this.map.dragPan.disable();
      this.map.getCanvas().style.cursor = 'crosshair';
    }
  };

  // ── Camera ───────────────────────────────────────────────────────────────

  fitBounds(b: [number, number, number, number] | null, maxZoom = 6, opts: { keepDetails?: boolean } = {}) {
    // On a phone, showing something else on the map means getting the details out of the way.
    if (!opts.keepDetails && window.innerWidth <= 760) useWorld.setState({ detailsOpen: false });
    if (!b) return;
    const pad = Math.min(120, Math.min(this.map.getContainer().clientWidth, this.map.getContainer().clientHeight) / 6);
    this.map.fitBounds(
      [
        [b[0], b[1]],
        [b[2], b[3]],
      ],
      { padding: pad, maxZoom, duration: 900 },
    );
  }

  /** Glides `p` to the middle of the part of the map the panels leave visible (zoom unchanged). */
  centerOn(p: LngLat) {
    this.map.easeTo({ center: p, duration: 550, essential: true });
  }

  private spinRaf = 0;
  private spinStop: (() => void) | null = null;

  /** Turns the globe slowly westward; any drag, pinch or wheel stops it (and calls `onStop`). */
  spin(on: boolean, onStop?: () => void) {
    cancelAnimationFrame(this.spinRaf);
    this.spinRaf = 0;
    this.spinStop?.();
    this.spinStop = null;
    if (!on) return;
    const m = this.map;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const c = m.getCenter();
      // ~4° a second at world zoom, slower when zoomed in.
      m.jumpTo({ center: [c.lng + (dt * 4) / Math.max(1, m.getZoom() / 2), c.lat] });
      this.spinRaf = requestAnimationFrame(step);
    };
    this.spinRaf = requestAnimationFrame(step);
    const stop = (e: { originalEvent?: Event }) => {
      if (!e.originalEvent) return; // our own jumpTo
      this.spin(false);
      onStop?.();
    };
    m.on('dragstart', stop);
    m.on('wheel', stop);
    m.on('touchstart', stop);
    m.on('mousedown', stop);
    this.spinStop = () => {
      m.off('dragstart', stop);
      m.off('wheel', stop);
      m.off('touchstart', stop);
      m.off('mousedown', stop);
    };
  }

  flyTo(p: LngLat, zoom?: number) {
    this.map.flyTo({ center: p, zoom: zoom ?? Math.max(this.map.getZoom(), 5), duration: 900 });
  }

  snapshot(): Promise<Blob | null> {
    return new Promise((resolve) => {
      this.map.once('render', () => this.map.getCanvas().toBlob((b) => resolve(b), 'image/png'));
      this.map.triggerRepaint();
    });
  }
}

/**
 * The first whole zoom at which a name of `chars` letters fits along `line` (the curved label
 * layer's size and spacing), or null when it never does before zoom 9. Below it the name stays
 * straight: MapLibre silently drops a name that does not fit its line.
 */
function fitZoom(line: LngLat[], chars: number, s: number, upper: boolean): number | null {
  let km = 0;
  const r = Math.PI / 180;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const h = Math.sin(((b[1] - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
    km += 2 * 6371 * Math.asin(Math.sqrt(h));
  }
  const lat = line[Math.floor(line.length / 2)][1];
  const size = (z: number) => (z <= 1 ? 8 + 7 * s : z <= 4 ? 8 + 7 * s + ((z - 1) / 3) * (3 + 5 * s) : z <= 7 ? 11 + 12 * s + ((z - 4) / 3) * (3 + 4 * s) : 14 + 16 * s);
  // Letters plus the layer's 0.28em spacing; capitals are wider.
  const em = upper ? 0.78 : 0.66;
  // MapLibre lays the text out in the tile of whole zoom z, at the size of zoom z + 1.
  for (let z = 1; z <= 9; z++) {
    const px = (km * 512 * 2 ** z) / (40075 * Math.max(0.2, Math.cos(lat * r)));
    if (chars * size(z + 1) * (em + 0.28) <= px * 0.92) return z;
  }
  return null;
}

/** A country colour washed out to grey, for countries outside the alliances shown. */
function mute(hex: string, dark: boolean): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const [r, g, b] = m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [200, 200, 200];
  const grey = (r + g + b) / 3;
  const base = dark ? 70 : 222;
  const mix = (v: number) => Math.round(base * 0.75 + (grey * 0.15 + v * 0.1));
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

export let mapCtl: MapController | null = null;
export function setMapCtl(c: MapController | null) {
  mapCtl = c;
}

/**
 * Drives the animated water layer: advances its clock and asks the map to redraw, throttled,
 * skipped while the page is hidden and stopped after 30 s without interaction (the waves then
 * stay still but keep their shading). Frozen for people who prefer reduced motion.
 */
class Waves {
  readonly layer = new WaterLayer();
  private raf = 0;
  private last = 0;
  private lastInput = performance.now();
  private on = false;
  private readonly frameMs: number;
  private readonly reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private bound = false;

  constructor(private ctl: MapController) {
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    // Each frame is one map redraw plus the water shader; the swell is slow, so ~20 steps a
    // second look fluid while leaving the GPU mostly idle.
    this.frameMs = 1000 / (coarse ? 15 : 22);
  }

  configure(on: boolean, look: Look) {
    const m = this.map;
    m.setPaintProperty('water-depth', 'color-relief-color', depthRamp(look.depth));
    this.layer.look = { light: rgb(look.water.light), shade: rgb(look.water.shade), strength: on ? look.water.strength : 0 };
    this.on = on && !this.reduced && look.water.strength > 0;
    if (!this.bound) this.bind();
    if (this.on) this.start();
    else this.stop();
    m.triggerRepaint();
  }

  private get map() {
    return this.ctl.map;
  }

  private bind() {
    this.bound = true;
    const wake = () => {
      this.lastInput = performance.now();
      if (this.on && !this.raf) this.start();
    };
    for (const ev of ['mousemove', 'touchstart', 'wheel', 'movestart'] as const) this.map.on(ev, wake);
    window.addEventListener('keydown', wake);
    document.addEventListener('visibilitychange', wake);
  }

  start() {
    if (this.raf || this.held) return;
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      if (document.hidden || now - this.last < this.frameMs) return;
      if (now - this.lastInput > 30_000) {
        this.stop();
        return;
      }
      // Clamp the step so coming back from a pause doesn't jump the waves.
      this.layer.time += Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.map.triggerRepaint();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Holds the waves still (e.g. while a poster renders, which needs the map to go idle). */
  hold(on: boolean) {
    this.held = on;
    if (on) this.stop();
    else if (this.on) this.start();
  }
  private held = false;
}
