// The map of the city view: a street basemap (OpenFreeMap, when online) with the city's
// districts and transit network on top, and the clicks that edit them.
import * as maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, GeoJSONSource, Map as MLMap, MapMouseEvent, MapTouchEvent, StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import type { District, LngLat } from '../types';
import { asset } from './style';
import { onWorldChange, regionsInBox, toast, useWorld } from '../world/store';
import { addDistrict, addStop, deleteDistrict, densityColors, districtAt, planOf, ringGeom, transitFeatures, updateStation } from '../world/city';
import { useCityUi, type Basemap } from '../world/cityUi';
import { bbox, labelPoint, pointInGeom } from '../geo/engine';
import { uid } from '../util';
import { MAIN, shownAreas, type Candidate } from '../io/osm';
import { growAt, growFrom } from '../io/areas';

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const OFM: Record<Exclude<Basemap, 'blank'>, string> = { light: 'positron', streets: 'liberty', dark: 'dark' };

const byZoom = (lo: ExpressionSpecification | number, hi: ExpressionSpecification | number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], 9, lo, 14, hi];

export class CityMap {
  readonly map: MLMap;
  private font = ['Open Sans Semibold'];
  private dark = false;
  private off: (() => void)[] = [];
  private draft: LngLat[] = [];
  private styleSeq = 0;
  private dead = false;
  private hoverArea: string | null = null;
  /** A station being dragged, and whether it has moved (then the click that follows is not a click). */
  private drag: { id: string; group: string; moved: boolean; x: number; y: number } | null = null;
  private skipClick = false;
  onReady?: () => void;

  constructor(
    container: HTMLElement,
    private cityId: number,
  ) {
    const city = useWorld.getState().doc!.cities[cityId];
    this.map = new maplibregl.Map({
      container,
      style: this.blankStyle(),
      center: [city.lng, city.lat],
      zoom: 11.5,
      minZoom: 6,
      maxZoom: 18,
      maxPitch: 0,
      dragRotate: false,
      boxZoom: false,
      attributionControl: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    this.map.on('style.load', () => this.install());
    this.map.once('load', () => {
      this.fit(false);
      this.onReady?.();
    });
    this.map.on('click', (e) => this.onClick(e));
    this.map.on('dblclick', (e) => {
      if (useCityUi.getState().tool === 'draw' && useCityUi.getState().tab === 'districts') {
        e.preventDefault();
        this.finishDraft();
      }
    });
    this.map.on('mousemove', (e) => this.onMove(e));
    this.map.on('mousedown', (e) => this.onDown(e));
    this.map.on('touchstart', (e) => this.onDown(e));
    this.map.on('touchmove', (e) => this.onMove(e));
    const up = () => this.onUp();
    this.map.on('mouseup', up);
    this.map.on('touchend', up);
    window.addEventListener('mouseup', up);
    this.off.push(() => window.removeEventListener('mouseup', up));
    this.off.push(onWorldChange((c) => (c.plans || c.all || c.cities) && this.refresh()));
    this.off.push(
      useCityUi.subscribe((s, p) => {
        if (s.basemap !== p.basemap) void this.setBasemap(s.basemap);
        if (s.tool !== p.tool || s.tab !== p.tab) this.cancelDraft();
        this.refresh();
      }),
    );
    void this.setBasemap(useCityUi.getState().basemap);
  }

  destroy() {
    cancelAnimationFrame(this.dragFrame);
    this.dead = true;
    this.off.forEach((f) => f());
    this.map.remove();
  }

  /** Room the panel takes, so the city is framed in what stays visible. */
  setInsets(right: number, bottom: number) {
    const c = this.map.getContainer();
    this.map.setPadding({ top: 70, left: 0, right: Math.min(right, c.clientWidth * 0.6), bottom: Math.min(bottom, c.clientHeight * 0.6) });
  }

  /** Frames the districts and the network (or the city's spot when it has neither). */
  fit(animate = true) {
    const plan = planOf(this.cityId);
    const pts: LngLat[] = Object.values(plan.stations).map((s) => [s.lng, s.lat]);
    for (const d of Object.values(plan.districts)) {
      const b = bbox(d.geom);
      pts.push([b[0], b[1]], [b[2], b[3]]);
    }
    const city = useWorld.getState().doc?.cities[this.cityId];
    if (!pts.length) {
      if (city) this.map.easeTo({ center: [city.lng, city.lat], zoom: 11.5, duration: animate ? 600 : 0 });
      return;
    }
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    this.map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 50, maxZoom: 14, duration: animate ? 600 : 0 });
  }

  flyTo(p: LngLat) {
    this.map.easeTo({ center: p, zoom: Math.max(this.map.getZoom(), 13), duration: 500 });
  }

  /** The visible part of the map as [west, south, east, north]. */
  viewBox(): [number, number, number, number] {
    const b = this.map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }

  // ── Basemap ────────────────────────────────────────────────────────────────

  /** No streets: the sea, and the land of the world around the city. Works offline. */
  private blankStyle(): StyleSpecification {
    return {
      version: 8,
      glyphs: asset('fonts/{fontstack}/{range}.pbf'),
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#cfe2ee' } }],
    };
  }

  private async setBasemap(b: Basemap) {
    const seq = ++this.styleSeq;
    let style: StyleSpecification | null = null;
    if (b !== 'blank') {
      try {
        const res = await fetch(`https://tiles.openfreemap.org/styles/${OFM[b]}`);
        if (!res.ok) throw new Error(String(res.status));
        style = (await res.json()) as StyleSpecification;
        delete style.projection;
      } catch {
        if (seq === this.styleSeq && !this.dead) toast('No street map without a connection: showing a blank one', 'error');
      }
    }
    if (seq !== this.styleSeq || this.dead) return;
    this.font = style ? ['Noto Sans Bold'] : ['Open Sans Semibold'];
    this.dark = !!style && b === 'dark';
    this.streets = !!style;
    this.map.setStyle(style ?? this.blankStyle(), { diff: false });
  }
  private streets = false;

  /** Adds our sources and layers to a freshly loaded style. */
  private install() {
    const m = this.map;
    if (m.getSource('ev-dist')) return;
    this.drawn = {};
    const ink = this.dark ? '#f2f5fa' : '#1c2333';
    const halo = this.dark ? 'rgba(10,14,24,0.85)' : 'rgba(255,255,255,0.9)';
    for (const id of ['ev-land', 'ev-dist', 'ev-dist-pts', 'ev-area', 'ev-net', 'ev-st', 'ev-ends', 'ev-draft', 'ev-centre']) m.addSource(id, { type: 'geojson', data: EMPTY, promoteId: 'id' });

    m.addLayer({ id: 'ev-land', type: 'fill', source: 'ev-land', paint: { 'fill-color': '#f1eee6' } });
    m.addLayer({ id: 'ev-land-line', type: 'line', source: 'ev-land', paint: { 'line-color': '#b9c4cf', 'line-width': 1 } });

    m.addLayer({ id: 'ev-dist-fill', type: 'fill', source: 'ev-dist', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.4 } });
    m.addLayer({ id: 'ev-dist-line', type: 'line', source: 'ev-dist', layout: { 'line-join': 'round' }, paint: { 'line-color': this.dark ? '#ffffff' : '#39445c', 'line-opacity': 0.75, 'line-width': byZoom(1, 2) } });
    m.addLayer({ id: 'ev-dist-sel', type: 'line', source: 'ev-dist', filter: ['==', ['get', 'id'], ''], layout: { 'line-join': 'round' }, paint: { 'line-color': this.dark ? '#ffffff' : '#111827', 'line-width': 4 } });

    m.addLayer({
      id: 'ev-area-fill',
      type: 'fill',
      source: 'ev-area',
      paint: { 'fill-color': '#22a88f', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.38, 0.1] },
    });
    m.addLayer({ id: 'ev-area-line', type: 'line', source: 'ev-area', paint: { 'line-color': this.dark ? '#7ff0d8' : '#0f7d69', 'line-width': 1.6, 'line-dasharray': [2.5, 2] } });

    const width = byZoom(['*', ['get', 'width'], 0.5], ['get', 'width']);
    const offset = byZoom(['*', ['get', 'offset'], ['get', 'width'], 0.62], ['*', ['get', 'offset'], ['get', 'width'], 1.18]);
    m.addLayer({
      id: 'ev-net-case',
      type: 'line',
      source: 'ev-net',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': this.dark ? '#0b1120' : '#ffffff', 'line-width': byZoom(['+', ['*', ['get', 'width'], 0.5], 1.5], ['+', ['get', 'width'], 2.5]), 'line-offset': offset },
    });
    m.addLayer({ id: 'ev-net', type: 'line', source: 'ev-net', filter: ['!', ['get', 'dashed']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': width, 'line-offset': offset } });
    m.addLayer({ id: 'ev-net-bus', type: 'line', source: 'ev-net', filter: ['get', 'dashed'], paint: { 'line-color': ['get', 'color'], 'line-width': width, 'line-offset': offset, 'line-dasharray': [2, 1.2] } });

    m.addLayer({ id: 'ev-draft-fill', type: 'fill', source: 'ev-draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#22a88f', 'fill-opacity': 0.22 } });
    m.addLayer({ id: 'ev-draft-line', type: 'line', source: 'ev-draft', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#0f7d69', 'line-width': 2.5 } });
    m.addLayer({ id: 'ev-draft-pts', type: 'circle', source: 'ev-draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': ['case', ['get', 'first'], 7, 4.5], 'circle-color': '#ffffff', 'circle-stroke-color': '#0f7d69', 'circle-stroke-width': 2.5 } });

    m.addLayer({
      id: 'ev-dist-label',
      type: 'symbol',
      source: 'ev-dist-pts',
      layout: {
        'text-field': ['case', ['==', ['get', 'num'], ''], ['get', 'name'], ['format', ['get', 'num'], { 'font-scale': 1.7 }, '\n', {}, ['get', 'name'], {}]],
        'text-font': this.font,
        'text-size': byZoom(10, 14),
        'text-max-width': 8,
        'text-line-height': 1.1,
        'text-padding': 4,
      },
      paint: { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 1.8 },
    });

    m.addLayer({ id: 'ev-centre', type: 'circle', source: 'ev-centre', paint: { 'circle-radius': 4, 'circle-color': ink, 'circle-stroke-color': halo, 'circle-stroke-width': 2, 'circle-opacity': 0.75 } });

    const hub = ['get', 'hub'] as ExpressionSpecification;
    m.addLayer({ id: 'ev-st-sel', type: 'circle', source: 'ev-st', filter: ['==', ['get', 'id'], ''], paint: { 'circle-radius': byZoom(9, 14), 'circle-color': '#3ecfb2', 'circle-opacity': 0.45 } });
    m.addLayer({
      id: 'ev-st',
      type: 'circle',
      source: 'ev-st',
      paint: {
        'circle-radius': byZoom(['case', hub, 3.6, 2.4], ['case', hub, 7.5, 5.5]),
        'circle-color': '#ffffff',
        'circle-stroke-color': ['case', hub, '#161b26', ['get', 'color']],
        'circle-stroke-width': byZoom(1.4, 2.6),
      },
    });
    m.addLayer({
      id: 'ev-st-label',
      type: 'symbol',
      source: 'ev-st',
      minzoom: 11,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': this.font,
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, ['case', ['any', hub, ['get', 'end']], 10.5, 0], 12.6, ['case', ['any', hub, ['get', 'end']], 12, 10.5], 15, 13.5],
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': 0.85,
        'text-max-width': 9,
        'text-optional': true,
      },
      paint: { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 1.6 },
    });
    // Above the station names, so a line's name at its end wins the place when both cannot fit.
    m.addLayer({
      id: 'ev-end-label',
      type: 'symbol',
      source: 'ev-ends',
      minzoom: 9.5,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': this.font,
        'text-size': byZoom(11, 15),
        'text-variable-anchor': ['bottom', 'top', 'left', 'right'],
        'text-radial-offset': 0.9,
        'text-padding': 1,
      },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': halo, 'text-halo-width': 2.2 },
    });
    this.refresh();
  }

  private src(id: string): GeoJSONSource | undefined {
    return this.map.getSource(id) as GeoJSONSource | undefined;
  }

  /** What each source was last drawn from: only what changed is sent to the map again. */
  private drawn: Record<string, unknown[]> = {};
  private changed(key: string, deps: unknown[]): boolean {
    const was = this.drawn[key];
    if (was && was.length === deps.length && was.every((v, i) => v === deps[i])) return false;
    this.drawn[key] = deps;
    return true;
  }
  /** Label anchors cost a search of the shape: kept per shape. */
  private anchors = new WeakMap<object, LngLat | null>();
  private anchor(geom: District['geom']): LngLat | null {
    let p = this.anchors.get(geom);
    if (p === undefined) this.anchors.set(geom, (p = labelPoint(geom)));
    return p;
  }

  /** Redraws what changed in the world or in the view's state. */
  refresh() {
    if (this.dead || !this.src('ev-dist')) return;
    const m = this.map;
    const ui = useCityUi.getState();
    const doc = useWorld.getState().doc;
    const city = doc?.cities[this.cityId];
    if (!doc || !city) return;
    const plan = planOf(this.cityId);
    const districts = ui.tab === 'districts';
    const ds = Object.values(plan.districts);

    // Without streets, the land of the world around the city gives the lie of the coast.
    const geoms = useWorld.getState().geoms;
    if (this.changed('land', [this.streets, geoms, city.lng, city.lat])) {
      const land: Feature[] = [];
      if (!this.streets) for (const id of regionsInBox([city.lng - 2, city.lat - 1.5, city.lng + 2, city.lat + 1.5])) if (geoms[id]) land.push({ type: 'Feature', geometry: geoms[id], properties: { id } });
      this.src('ev-land')!.setData({ type: 'FeatureCollection', features: land });
    }

    const density = districts && ui.density ? densityColors(plan) : null;
    if (this.changed('dist', [plan.districts, !!density])) {
      this.src('ev-dist')!.setData({
        type: 'FeatureCollection',
        features: ds.map((d) => ({ type: 'Feature', geometry: d.geom, properties: { id: d.id, color: density ? density.colors[d.id] ?? '#c9ced8' : d.color } })),
      });
      this.src('ev-dist-pts')!.setData({
        type: 'FeatureCollection',
        features: ds.flatMap((d) => {
          const p = this.anchor(d.geom);
          return p ? [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: p }, properties: { id: d.id, name: d.name, num: d.num != null ? String(d.num) : '' } }] : [];
        }),
      });
    }

    // Real areas on offer: the chosen size, minus those already made into districts.
    const offer = districts && ui.tool === 'real';
    if (this.changed('area', [offer, offer && ui.areas, offer && ui.level, offer && plan.districts])) {
      const used = new Set(ds.map((d) => d.src));
      const areas = offer ? shownAreas(ui.areas ?? [], ui.level).filter((a) => !used.has(a.id)) : [];
      this.hoverArea = null;
      this.src('ev-area')!.setData({ type: 'FeatureCollection', features: areas.map((a) => ({ type: 'Feature', geometry: a.geom, properties: { id: a.id, name: a.name, area: a.area } })) });
    }

    if (this.changed('net', [plan.stations, plan.lines])) {
      const net = transitFeatures(plan);
      this.src('ev-net')!.setData(net.lines);
      this.src('ev-st')!.setData(net.stations);
      this.src('ev-ends')!.setData(net.ends);
    }
    const empty = !ds.length && !Object.keys(plan.stations).length;
    if (this.changed('centre', [empty, city.lng, city.lat]))
      this.src('ev-centre')!.setData({ type: 'FeatureCollection', features: empty ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [city.lng, city.lat] }, properties: { id: 'c' } }] : [] });

    const active = !districts && ui.line && plan.lines[ui.line] ? ui.line : null;
    if (this.changed('look', [districts, active, ui.district, ui.station, ui.tool, !!density])) {
      m.setFilter('ev-dist-sel', ['==', ['get', 'id'], (districts && ui.district) || '']);
      m.setPaintProperty('ev-dist-fill', 'fill-opacity', density ? 0.62 : districts ? 0.42 : 0.16);
      m.setPaintProperty('ev-dist-line', 'line-opacity', districts ? 0.8 : 0.35);
      const fade: ExpressionSpecification | number = districts ? 0.45 : active ? ['case', ['==', ['get', 'line'], active], 1, 0.4] : 1;
      for (const id of ['ev-net', 'ev-net-bus']) m.setPaintProperty(id, 'line-opacity', fade);
      m.setPaintProperty('ev-net-case', 'line-opacity', districts ? 0.3 : 0.9);
      // While districts are worked on, the network steps back: faint stations, no names.
      m.setPaintProperty('ev-st', 'circle-opacity', districts ? 0.35 : 1);
      m.setPaintProperty('ev-st', 'circle-stroke-opacity', districts ? 0.35 : 1);
      for (const id of ['ev-st-label', 'ev-end-label']) m.setLayoutProperty(id, 'visibility', districts ? 'none' : 'visible');
      m.setFilter('ev-st-sel', ['==', ['get', 'id'], (!districts && ui.station) || '']);
      m.doubleClickZoom[districts && ui.tool === 'draw' ? 'disable' : 'enable']();
      this.drawDraft();
    }
  }

  /** A picture of the map as it is shown (read inside a render, so no costly preserved buffer is needed). */
  snapshot(): Promise<Blob | null> {
    return new Promise((resolve) => {
      this.map.once('render', () => this.map.getCanvas().toBlob((b) => resolve(b), 'image/png'));
      this.map.triggerRepaint();
    });
  }

  // ── Drawing a district ─────────────────────────────────────────────────────

  get draftPoints(): number {
    return this.draft.length;
  }

  private drawDraft(cursor?: LngLat) {
    const pts = this.draft;
    const features: Feature[] = pts.map((p, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { id: `p${i}`, first: i === 0 && pts.length > 2 } }));
    const path = cursor ? [...pts, cursor] : pts;
    if (path.length > 1) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: path.length > 2 ? [...path, path[0]] : path }, properties: { id: 'l' } });
    if (path.length > 2) features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...path, path[0]]] }, properties: { id: 'a' } });
    this.src('ev-draft')?.setData({ type: 'FeatureCollection', features });
  }

  private setDraft(pts: LngLat[]) {
    this.draft = pts;
    useCityUi.setState({ draft: pts.length });
    this.drawDraft();
  }

  undoDraftPoint() {
    if (this.draft.length) this.setDraft(this.draft.slice(0, -1));
  }

  cancelDraft() {
    if (this.draft.length) this.setDraft([]);
  }

  /** Turns the points drawn into a district. */
  finishDraft() {
    const geom = ringGeom(this.draft);
    if (!geom) return;
    this.setDraft([]);
    const id = addDistrict(this.cityId, geom);
    if (id) useCityUi.setState({ tool: 'pick', district: id });
  }

  // ── Pointer ────────────────────────────────────────────────────────────────

  private hit(e: { point: maplibregl.Point }, layers: string[], reach = 0) {
    const have = layers.filter((l) => this.map.getLayer(l));
    if (!have.length) return [];
    const { x, y } = e.point;
    return this.map.queryRenderedFeatures(reach ? [[x - reach, y - reach], [x + reach, y + reach]] : e.point, { layers: have });
  }

  private stationAt(e: { point: maplibregl.Point }): string | null {
    const f = this.hit(e, ['ev-st'], 9)[0];
    return f ? String(f.properties.id) : null;
  }

  private onClick(e: MapMouseEvent) {
    if (this.skipClick) {
      this.skipClick = false;
      return;
    }
    const ui = useCityUi.getState();
    const at: LngLat = [e.lngLat.lng, e.lngLat.lat];
    if (ui.tab === 'districts') {
      if (ui.tool === 'draw') {
        // A click back on the first point closes the shape.
        if (this.draft.length > 2) {
          const p = this.map.project(this.draft[0]);
          if (Math.hypot(p.x - e.point.x, p.y - e.point.y) < 14) return this.finishDraft();
        }
        return this.setDraft([...this.draft, [+at[0].toFixed(6), +at[1].toFixed(6)]]);
      }
      if (ui.tool === 'real') {
        // Where sizes nest, the smallest area under the click.
        const f = this.hit(e, ['ev-area-fill']).sort((a, b) => Number(a.properties.area) - Number(b.properties.area))[0];
        const taken = new Set(Object.values(planOf(this.cityId).districts).map((d) => d.src));
        // What is drawn under the click, or failing that what is known there (the map may not have drawn it yet).
        const area =
          (f && ui.areas?.find((a) => a.id === f.properties.id)) ||
          (this.hit(e, ['ev-dist-fill']).length
            ? undefined
            : shownAreas(ui.areas ?? [], ui.level)
                .filter((a) => !taken.has(a.id) && pointInGeom(at, a.geom))
                .sort((a, b) => a.area - b.area)[0]);
        if (area) {
          // Not selected: the next click is most likely the area beside it.
          addDistrict(this.cityId, area.geom, { name: area.name, pop: area.pop, src: area.id });
          void this.grow(() => growFrom(this.city(), area).then((areas) => (areas ? { areas, town: null } : null)));
          return;
        }
        // A real area tapped again leaves the city (a slip of the finger is one tap to mend).
        const mine = this.hit(e, ['ev-dist-fill'])[0];
        const d = mine && planOf(this.cityId).districts[String(mine.properties.id)];
        if (d?.src) {
          deleteDistrict(this.cityId, d.id);
          return;
        }
        // Beyond what is known: the town at that spot joins the city, and its neighbours come within reach.
        if (!mine) {
          void this.grow(() => growAt(this.city(), at), true);
          return;
        }
      }
      const f = this.hit(e, ['ev-dist-fill'])[0];
      useCityUi.setState({ district: f ? String(f.properties.id) : null });
      return;
    }
    // Transit.
    const plan = planOf(this.cityId);
    const line = ui.line ? plan.lines[ui.line] : undefined;
    const sid = this.stationAt(e);
    if (sid) {
      // A station of another line joins the active one: an interchange.
      if (line && !line.stops.includes(sid)) addStop(this.cityId, line.id, sid);
      useCityUi.setState({ station: sid });
      return;
    }
    const seg = this.hit(e, ['ev-net', 'ev-net-bus'], 6);
    if (!line) {
      const f = seg[0];
      useCityUi.setState(f ? { line: String(f.properties.line), station: null } : { station: null });
      return;
    }
    // On the active line: a stop between two others. Elsewhere: the line grows by one stop.
    const on = seg.find((f) => f.properties.line === line.id);
    const id = addStop(this.cityId, line.id, at, { index: on ? Number(on.properties.after) + 1 : undefined, name: this.nameAt(e.point, at) });
    if (id) useCityUi.setState({ station: id });
  }

  private city() {
    return useWorld.getState().doc!.cities[this.cityId];
  }

  private growing = 0;
  /** Collects more towns in the background and puts them on offer; `add` also makes the town found a district. */
  private async grow(find: () => Promise<{ areas: Candidate[]; town: Candidate | null } | null>, add = false) {
    this.growing++;
    useCityUi.setState({ growing: true });
    try {
      const found = await find();
      if (this.dead || !found) return;
      useCityUi.setState({ areas: found.areas, level: useCityUi.getState().level ?? MAIN });
      const t = found.town;
      if (!add) return;
      if (!t) toast('No town known at this spot: draw it yourself', 'error');
      else if (!Object.values(planOf(this.cityId).districts).some((d) => d.src === t.id)) {
        addDistrict(this.cityId, t.geom, { name: t.name, pop: t.pop, src: t.id });
        toast(`${t.name} joins the city`, 'ok');
      }
    } catch {
      if (add && !this.dead) toast('Could not fetch the town here (no connection?)', 'error');
    } finally {
      if (!--this.growing && !this.dead) useCityUi.setState({ growing: false });
    }
  }

  /** A name for a station placed here: the nearest street, else the neighbourhood or the district. */
  private nameAt(point: maplibregl.Point, at: LngLat): string | undefined {
    const taken = new Set(Object.values(planOf(this.cityId).stations).map((s) => s.name));
    let best: string | undefined;
    let bestD = 70;
    if (this.streets && this.map.getSource('openmaptiles')) {
      try {
        for (const layer of ['transportation_name', 'place']) {
          for (const f of this.map.querySourceFeatures('openmaptiles', { sourceLayer: layer })) {
            const name = (f.properties?.['name:latin'] ?? f.properties?.name) as string | undefined;
            if (!name || taken.has(name)) continue;
            if (layer === 'place' && !['suburb', 'quarter', 'neighbourhood'].includes(String(f.properties?.class))) continue;
            const g = f.geometry;
            const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : g.type === 'Point' ? [[g.coordinates]] : [];
            for (const l of lines) {
              const px = l.map((c) => this.map.project(c as LngLat));
              for (let i = 0; i < px.length; i++) {
                const d = i ? segDist(point, px[i - 1], px[i]) : Math.hypot(px[0].x - point.x, px[0].y - point.y);
                // A neighbourhood's name sits somewhere in it: only when no street is at hand.
                const w = layer === 'place' ? d / 4 + 40 : d;
                if (w < bestD) {
                  bestD = w;
                  best = name;
                }
              }
            }
          }
        }
      } catch {
        /* no names then */
      }
    }
    if (best) return best;
    const d = districtAt(planOf(this.cityId), at);
    return d && !taken.has(d.name) ? d.name : undefined;
  }

  private onDown(e: MapMouseEvent | MapTouchEvent) {
    if (useCityUi.getState().tab !== 'transit') return;
    if ('touches' in e.originalEvent && e.originalEvent.touches.length > 1) return;
    const id = this.stationAt(e);
    if (!id) return;
    // The map stays put: the station moves instead.
    e.preventDefault();
    this.drag = { id, group: `move:${uid()}`, moved: false, x: e.point.x, y: e.point.y };
  }

  private onMove(e: MapMouseEvent | MapTouchEvent) {
    const ui = useCityUi.getState();
    if (this.drag) {
      if (!this.drag.moved && Math.hypot(e.point.x - this.drag.x, e.point.y - this.drag.y) < 4) return;
      this.drag.moved = true;
      // At most one move a frame: each one redraws the network and is written to the world.
      this.dragTo = [+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)];
      this.dragFrame ||= requestAnimationFrame(() => this.flushDrag());
      return;
    }
    if (ui.tab === 'districts' && ui.tool === 'draw') {
      if (this.draft.length) this.drawDraft([e.lngLat.lng, e.lngLat.lat]);
      this.map.getCanvas().style.cursor = 'crosshair';
      return;
    }
    let cursor = '';
    if (ui.tab === 'districts') {
      const f = ui.tool === 'real' ? this.hit(e, ['ev-area-fill']).sort((a, b) => Number(a.properties.area) - Number(b.properties.area))[0] : undefined;
      const id = f ? String(f.properties.id) : null;
      if (id !== this.hoverArea) {
        if (this.hoverArea) this.map.setFeatureState({ source: 'ev-area', id: this.hoverArea }, { hover: false });
        if (id) this.map.setFeatureState({ source: 'ev-area', id }, { hover: true });
        this.hoverArea = id;
      }
      if (id || this.hit(e, ['ev-dist-fill']).length) cursor = 'pointer';
    } else if (this.stationAt(e)) cursor = 'grab';
    else if (ui.line) cursor = 'crosshair';
    else if (this.hit(e, ['ev-net', 'ev-net-bus'], 6).length) cursor = 'pointer';
    this.map.getCanvas().style.cursor = cursor;
  }

  private dragTo: LngLat | null = null;
  private dragFrame = 0;
  private flushDrag() {
    cancelAnimationFrame(this.dragFrame);
    this.dragFrame = 0;
    const to = this.dragTo;
    this.dragTo = null;
    if (to && this.drag && !this.dead) updateStation(this.cityId, this.drag.id, { lng: to[0], lat: to[1] }, 'Move station', this.drag.group);
  }

  private onUp() {
    if (!this.drag) return;
    this.flushDrag();
    // The click that ends a drag neither selects nor adds anything.
    if (this.drag.moved) {
      this.skipClick = true;
      setTimeout(() => (this.skipClick = false), 50);
      useCityUi.setState({ station: this.drag.id });
    }
    this.drag = null;
  }
}

function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

export let cityMap: CityMap | null = null;
export const setCityMap = (m: CityMap | null) => (cityMap = m);
