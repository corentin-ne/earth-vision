import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MLMap, MapMouseEvent, PointLike } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, Point } from 'geojson';
import type { Country, LngLat } from '../types';
import { LOOKS, baseStyle, asset, depthRamp, type Look } from './style';
import { WaterLayer, rgb } from './water';
import {
  useWorld,
  engine,
  onWorldChange,
  countryAggregates,
  transferRegions,
  endGroup,
  select,
  splitAlong,
  addCity,
  updateCity,
  toast,
  type ChangeSet,
  type State,
} from '../world/store';
import { loadIso2, iso2 } from '../world/flags';

maplibregl.setWorkerUrl(workerUrl);

const get = useWorld.getState;
const fc = <G extends Feature['geometry']>(features: Feature<G>[]): FeatureCollection<G> => ({ type: 'FeatureCollection', features });

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
  private stroke: { group: string; last: [number, number] } | null = null;
  private spaceDown = false;
  private draggingCity: number | null = null;
  onHover?: (info: { x: number; y: number; region: number | null; city: number | null } | null) => void;
  onDrawChange?: (n: number) => void;

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
    const { right, bottom } = get().inspectorInset;
    // Never pad away more than most of the map (a full-height sheet still leaves a strip).
    const h = this.map.getContainer().clientHeight;
    const w = this.map.getContainer().clientWidth;
    this.map.setPadding({ top: mobile ? 56 : 0, left: 0, bottom: Math.min(bottom, h * 0.6), right: Math.min(right, w * 0.6) });
  };

  private async onLoad() {
    this.updatePadding();
    window.addEventListener('resize', this.updatePadding);
    await loadIso2();
    this.addIcons();
    try {
      this.map.addLayer(this.waves.layer, 'graticule');
    } catch (e) {
      console.warn('animated water unavailable', e);
    }
    this.loaded = true;
    this.applyLook();
    this.syncAll();
    this.bindInteractions();
    this.unsubs.push(onWorldChange((c) => this.onChange(c)));
    this.unsubs.push(
      useWorld.subscribe((s, p) => {
        if (s.mapStyle !== p.mapStyle || s.layers !== p.layers || s.globe !== p.globe) this.applyLook();
        if (s.selection !== p.selection) this.syncSelection();
        if (s.inspectorInset !== p.inspectorInset) this.updatePadding();
        if (s.tool !== p.tool) this.onToolChange(s, p);
      }),
    );
    // The panel may have reported its size while the map was still loading.
    this.updatePadding();
    this.map.on('moveend', () => {
      const doc = get().doc;
      if (!doc) return;
      const c = this.map.getCenter();
      useWorld.setState({
        doc: { ...doc, view: { center: [+c.lng.toFixed(4), +c.lat.toFixed(4)], zoom: +this.map.getZoom().toFixed(2), bearing: this.map.getBearing(), pitch: this.map.getPitch() } },
      });
    });
  }

  destroy() {
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
    paint('region-fill', 'fill-opacity', L.fillOpacity);
    vis('region-seam', L.seam);
    vis('hillshade', layers.hillshade && L.hillshade);
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
    m.setLayoutProperty('country-labels', 'text-field', L.labelUpper ? ['upcase', ['get', 'name']] : ['get', 'name']);
    m.setLayoutProperty('country-labels', 'icon-image', layers.flags ? ['get', 'flag'] : '');

    m.setTerrain(layers.terrain ? { source: 'dem-terrain', exaggeration: 18 } : null);
    this.recolorAll();
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
    this.syncSelection();
  }

  private syncRegionsData() {
    const { doc, geoms } = get();
    if (!doc) return;
    const features: Feature[] = [];
    for (const [id, g] of Object.entries(geoms)) {
      if (doc.regions[Number(id)]) features.push({ type: 'Feature', id: Number(id), properties: {}, geometry: g });
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

  private colorOf(cid: string): string {
    const { doc, mapStyle } = get();
    const c = doc?.countries[cid];
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
    const doc = get().doc;
    if (!doc || !this.loaded) return;
    for (const r of Object.values(doc.regions)) this.setColor(r.id, this.colorOf(r.cid));
  }

  private recolor(regionIds: Set<number>, countries: Set<string>) {
    const doc = get().doc!;
    for (const id of regionIds) {
      const r = doc.regions[id];
      if (r) this.setColor(id, this.colorOf(r.cid));
    }
    if (countries.size) {
      for (const r of Object.values(doc.regions)) if (countries.has(r.cid)) this.setColor(r.id, this.colorOf(r.cid));
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
    const asFc = (g: typeof b.coast) => fc([{ type: 'Feature', properties: {}, geometry: g }]);
    this.src('borders-country')?.setData(asFc(b.countries));
    this.src('borders-region')?.setData(asFc(b.regions));
    this.src('coast')?.setData(asFc(b.coast));
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
        properties: { cid: c.cid, name: c.name, s: +s.toFixed(3), flag: this.flagImage(c) },
        geometry: { type: 'Point', coordinates: c.label },
      });
    }
    this.src('country-labels')?.setData(fc(features));
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
      features.push({ type: 'Feature', properties: { kind: 'country' }, geometry: engine.outline((rid) => doc.regions[rid]?.cid === cid) });
    }
    if (selection.regions.length && engine.ready) {
      features.push({ type: 'Feature', properties: { kind: 'region' }, geometry: engine.outline((rid) => nextSel.has(rid)) });
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
      const H = 44;
      const W = Math.round(Math.min(78, Math.max(44, (img.naturalWidth / img.naturalHeight) * H)));
      const pad = 3;
      const canvas = document.createElement('canvas');
      canvas.width = W + pad * 2;
      canvas.height = H + pad * 2;
      const ctx = canvas.getContext('2d')!;
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
    const f = this.map.queryRenderedFeatures(p, { layers: ['region-fill'] })[0];
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
      if (this.stroke && e.points.length === 1) this.paintTo(e.point.x, e.point.y);
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private onMove(e: MapMouseEvent) {
    const { tool } = get();
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
    if (tool === 'split' && this.drawPts.length) {
      this.renderDraw([e.lngLat.lng, e.lngLat.lat]);
    }
    const city = tool !== 'paint' ? this.cityAtPoint(e.point) : null;
    const region = city == null ? this.regionAtPoint(e.point) : null;
    this.setHover(tool === 'split' ? null : region);
    this.map.getCanvas().style.cursor = tool === 'select' ? (city != null || region != null ? 'pointer' : '') : tool === 'city' ? (city != null ? 'move' : 'copy') : 'crosshair';
    this.onHover?.({ x: e.point.x, y: e.point.y, region, city });
  }

  private onClick(e: MapMouseEvent) {
    const { tool, doc, selection } = get();
    if (!doc) return;
    const oe = e.originalEvent as MouseEvent;
    if (tool === 'select') {
      const city = this.cityAtPoint(e.point);
      if (city != null) {
        const c = doc.cities[city];
        select({ city, anchor: [c.lng, c.lat] });
        this.centerOn([c.lng, c.lat]);
        return;
      }
      const rid = this.regionAtPoint(e.point);
      if (rid == null) {
        select({});
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
      this.stroke = { group: `paint:${Date.now()}`, last: [e.point.x, e.point.y] };
      if (oe?.ctrlKey || oe?.metaKey || mode === 'whole') {
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

  private onUp() {
    if (this.stroke) {
      this.stroke = null;
      endGroup();
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
    const feats = this.map.queryRenderedFeatures(q, { layers: ['region-fill'] });
    const ids = new Set<number>();
    for (const f of feats) if (f.id != null && doc.regions[Number(f.id)]?.cid !== brushCid) ids.add(Number(f.id));
    if (ids.size) transferRegions([...ids], brushCid, { group: this.stroke.group, label: `Paint ${doc.countries[brushCid]?.name ?? 'unclaimed'}` });
  }

  private renderDraw(cursor?: LngLat) {
    const pts = cursor ? [...this.drawPts, cursor] : this.drawPts;
    const features: Feature[] = this.drawPts.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }));
    if (pts.length > 1) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } });
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

  undoDrawPoint() {
    this.drawPts.pop();
    this.renderDraw();
  }

  private onToolChange(s: State, p: State) {
    if (p.tool === 'split') this.cancelDraw();
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

  fitBounds(b: [number, number, number, number] | null, maxZoom = 6) {
    // Showing something on the map means getting the details window out of the way.
    useWorld.setState({ detailsOpen: false });
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

  flyTo(p: LngLat, zoom?: number) {
    useWorld.setState({ detailsOpen: false });
    this.map.flyTo({ center: p, zoom: zoom ?? Math.max(this.map.getZoom(), 5), duration: 900 });
  }

  snapshot(): Promise<Blob | null> {
    return new Promise((resolve) => {
      this.map.once('render', () => this.map.getCanvas().toBlob((b) => resolve(b), 'image/png'));
      this.map.triggerRepaint();
    });
  }
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
    if (this.raf) return;
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
}
