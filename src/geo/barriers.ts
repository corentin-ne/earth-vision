// Natural borders: the rivers and mountain crests that the "stop at rivers & crests" brush
// treats as walls, and along which regions get cut so a claim ends exactly on them.
import type { FeatureCollection, MultiLineString, LineString, Position } from 'geojson';
import type { LngLat } from '../types';

export type RiverLevel = 'off' | 'major' | 'all';
export interface NaturalOpts {
  rivers: RiverLevel;
  crests: boolean;
}

export const naturalOn = (o: NaturalOpts) => o.rivers !== 'off' || o.crests;
/** Natural Earth scalerank: ≤ 6 keeps the Danube, Rhine, Elbe, Loire, Rhône, Po, Garonne… */
const RIVER_RANK: Record<RiverLevel, number> = { off: -1, major: 6, all: 8 };

const enum Kind {
  River = 0,
  Crest = 1,
}

interface Line {
  pts: LngLat[];
  kind: Kind;
  rank: number;
  name: string;
}

const CELL = 1; // degrees
const cellKey = (cx: number, cy: number) => (cx + 400) * 1000 + (cy + 200);

/** Spatial index of the barrier lines' segments. */
export class Barriers {
  private lines: Line[] = [];
  /** Per segment: line index and index of its first point. */
  private segLine: Int32Array;
  private segIdx: Int32Array;
  private grid = new Map<number, number[]>();
  private stamp: Uint32Array;
  private tick = 0;

  constructor(rivers: FeatureCollection, crests: FeatureCollection) {
    const add = (kind: Kind, rank: number, name: string, coords: Position[][]) => {
      for (const c of coords) if (c.length >= 2) this.lines.push({ pts: c as LngLat[], kind, rank, name });
    };
    const parts = (g: LineString | MultiLineString | null) => (!g ? [] : g.type === 'LineString' ? [g.coordinates] : g.coordinates);
    for (const f of rivers.features) add(Kind.River, Number(f.properties?.scalerank ?? 9), String(f.properties?.name ?? ''), parts(f.geometry as LineString));
    for (const f of crests.features) add(Kind.Crest, 0, '', parts(f.geometry as MultiLineString));
    let n = 0;
    for (const l of this.lines) n += l.pts.length - 1;
    this.segLine = new Int32Array(n);
    this.segIdx = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    let s = 0;
    this.lines.forEach((l, li) => {
      for (let i = 0; i + 1 < l.pts.length; i++, s++) {
        this.segLine[s] = li;
        this.segIdx[s] = i;
        const [ax, ay] = l.pts[i];
        const [bx, by] = l.pts[i + 1];
        for (let cx = Math.floor(Math.min(ax, bx) / CELL); cx <= Math.floor(Math.max(ax, bx) / CELL); cx++)
          for (let cy = Math.floor(Math.min(ay, by) / CELL); cy <= Math.floor(Math.max(ay, by) / CELL); cy++) {
            const k = cellKey(cx, cy);
            const list = this.grid.get(k);
            if (list) list.push(s);
            else this.grid.set(k, [s]);
          }
      }
    });
  }

  private active(line: Line, o: NaturalOpts) {
    return line.kind === Kind.Crest ? o.crests : line.rank <= RIVER_RANK[o.rivers];
  }

  /** Every active segment id with a grid cell overlapping the box (each once). */
  private segments(x0: number, y0: number, x1: number, y1: number, o: NaturalOpts, visit: (s: number) => boolean | void) {
    const t = ++this.tick;
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        const list = this.grid.get(cellKey(cx, cy));
        if (!list) continue;
        for (const s of list) {
          if (this.stamp[s] === t) continue;
          this.stamp[s] = t;
          if (this.active(this.lines[this.segLine[s]], o) && visit(s) === true) return;
        }
      }
  }

  /** Whether going straight from a to b crosses an active river or crest. */
  crosses(a: LngLat, b: LngLat, o: NaturalOpts): boolean {
    if (!naturalOn(o) || (a[0] === b[0] && a[1] === b[1])) return false;
    let hit = false;
    this.segments(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), o, (s) => {
      const l = this.lines[this.segLine[s]].pts;
      const i = this.segIdx[s];
      if (cross(a, b, l[i], l[i + 1])) return (hit = true);
    });
    return hit;
  }

  /** The active lines passing through a box, as runs of consecutive points. */
  linesIn(box: [number, number, number, number], o: NaturalOpts): LngLat[][] {
    const pad = 0.01;
    const byLine = new Map<number, number[]>();
    this.segments(box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad, o, (s) => {
      const li = this.segLine[s];
      const list = byLine.get(li);
      if (list) list.push(this.segIdx[s]);
      else byLine.set(li, [this.segIdx[s]]);
    });
    const out: LngLat[][] = [];
    for (const [li, idx] of byLine) {
      const pts = this.lines[li].pts;
      idx.sort((a, b) => a - b);
      // One run per stretch of consecutive segments, padded by a segment each side so a line
      // that only grazes the box still crosses it from border to border.
      let start = idx[0];
      for (let k = 1; k <= idx.length; k++) {
        if (k < idx.length && idx[k] === idx[k - 1] + 1) continue;
        const end = idx[k - 1] + 1;
        out.push(pts.slice(Math.max(0, start - 1), Math.min(pts.length, end + 2)));
        if (k < idx.length) start = idx[k];
      }
    }
    return out;
  }

  /** The active lines, to draw them on the map. */
  geojson(o: NaturalOpts): FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: this.lines
        .filter((l) => this.active(l, o))
        .map((l) => ({ type: 'Feature', properties: { kind: l.kind === Kind.Crest ? 'crest' : 'river', name: l.name }, geometry: { type: 'LineString', coordinates: l.pts } })),
    };
  }

  /** A short key for the active set, to cache work per setting. */
  static key(o: NaturalOpts) {
    return `${o.rivers}|${o.crests ? 1 : 0}`;
  }
}

/** Proper crossing of segments p1-p2 and p3-p4 (touching ends count). */
function cross(p1: LngLat, p2: LngLat, p3: LngLat, p4: LngLat): boolean {
  const d = (a: LngLat, b: LngLat, c: LngLat) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 >= 0 && d2 <= 0) || (d1 <= 0 && d2 >= 0)) && ((d3 >= 0 && d4 <= 0) || (d3 <= 0 && d4 >= 0)) && !(d1 === 0 && d2 === 0);
}

let loaded: Barriers | null = null;
let loading: Promise<Barriers> | null = null;

/** The barrier lines, once loaded (null before). */
export const barriers = () => loaded;

export function setBarriers(b: Barriers | null) {
  loaded = b;
}

/** Loads the bundled rivers and crests (once). */
export function loadBarriers(): Promise<Barriers> {
  if (loaded) return Promise.resolve(loaded);
  const url = (p: string) => new URL(p, document.baseURI).href;
  loading ??= Promise.all([fetch(url('data/rivers.json')).then((r) => r.json()), fetch(url('data/crests.json')).then((r) => r.json())])
    .then(([rivers, crests]) => (loaded = new Barriers(rivers, crests)))
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}
