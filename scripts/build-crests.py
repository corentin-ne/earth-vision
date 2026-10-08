"""Builds public/data/crests.json: the crest lines of the world's mountain ranges.

  python scripts/build-crests.py

The crests are watershed divides that run over high, steep ground — where water parts ways
on either side of a range (the Pyrenees between the Ebro and the Garonne, the Vosges between
the Moselle and the Rhine, the Andes between the Pacific and the Amazon…). Natural borders
the "stop at crests" brush can follow.

1. Mosaic the zoom-4 terrarium tiles in .cache/dem (see fetch-assets.sh) at half resolution.
2. Route water with a priority flood from the coasts (fills pits, every cell gets a downstream).
3. Accumulate drainage area; label sub-basins: every tributary draining more than MIN_BASIN km²
   gets its own label where it joins a bigger river.
4. Keep the grid edges between two labels that sit high above the land around them, chain them
   into lines, smooth and simplify.
"""
import heapq
import json
import math
import os

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '.cache', 'dem', '4')
OUT = os.path.join(ROOT, 'public', 'data', 'crests.json')

Z = 4
TILE = 256
DOWN = 1  # 4096 px world: ~5-10 km per cell over the inhabited latitudes
LAT_TOP, LAT_BOTTOM = 76.0, -57.0
MIN_BASIN = 40000.0  # km²: tributaries smaller than this stay part of their river's basin
MIN_ELEV = 450.0  # m: a crest is at least this high…
MIN_RELIEF = 380.0  # m: …and this far above the lowest ground within RELIEF_RADIUS cells
RELIEF_RADIUS = 6
MIN_CELLS = 12  # shortest crest kept, in cells
MIN_SYSTEM = 15000.0  # km²: both river systems a crest parts are at least this big
MIN_RISE = 0.5  # a crest rises over at least this share of its height above the lowlands around
LOWLAND_RADIUS = 25  # cells (~150 km): how far around to look for those lowlands
CREST_SHARE = 0.5  # share of a divide that must run over high ground for it to be a crest


def mosaic():
    n = 1 << Z
    world = n * TILE
    elev = np.zeros((world, world), dtype=np.float32)
    for x in range(n):
        for y in range(n):
            p = os.path.join(SRC, str(x), f'{y}.png')
            a = np.asarray(Image.open(p).convert('RGB')).astype(np.float32)
            elev[y * TILE:(y + 1) * TILE, x * TILE:(x + 1) * TILE] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    if DOWN > 1:
        elev = elev.reshape(world // DOWN, DOWN, world // DOWN, DOWN).mean(axis=(1, 3))
    return elev


def merc_row(lat, size):
    return (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * size


def main():
    full = mosaic()
    size = full.shape[0]
    r0 = int(merc_row(LAT_TOP, size))
    r1 = int(math.ceil(merc_row(LAT_BOTTOM, size)))
    elev = full[r0:r1].astype(np.float64)
    H, W = elev.shape
    print('grid', W, 'x', H)

    rows = np.arange(H) + r0 + 0.5
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * rows / size))))
    km = 40075.0 / size * np.cos(np.radians(lat))  # cell side in km, per row
    cell_area = np.repeat((km * km)[:, None], W, axis=1).ravel()

    land = (elev > 0).ravel()
    e = elev.ravel()
    N = H * W
    down = np.full(N, -1, dtype=np.int64)
    filled = e.copy()
    done = np.zeros(N, dtype=bool)
    order = []

    # Seeds: land cells touching the sea (or the cropped edges). Longitude wraps around.
    heap = []
    tick = 0
    sea = ~land.reshape(H, W)
    near_sea = ndimage.binary_dilation(sea, structure=np.ones((3, 3), bool))
    near_sea[0, :] = near_sea[-1, :] = True
    seeds = np.flatnonzero(near_sea.ravel() & land)
    for i in seeds:
        heapq.heappush(heap, (e[i], tick, int(i)))
        tick += 1
        done[i] = True
    offs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    landl = land.tolist()
    filledl = filled.tolist()
    downl = down.tolist()
    donel = done.tolist()
    push, pop = heapq.heappush, heapq.heappop
    while heap:
        h, _, i = pop(heap)
        order.append(i)
        y, x = divmod(i, W)
        for dy, dx in offs:
            ny = y + dy
            if ny < 0 or ny >= H:
                continue
            j = ny * W + (x + dx) % W
            if donel[j] or not landl[j]:
                continue
            donel[j] = True
            downl[j] = i
            v = filledl[j]
            if v < h:
                v = h
                filledl[j] = v
            push(heap, (v, tick, j))
            tick += 1
    down = np.array(downl, dtype=np.int64)
    print('routed', len(order), 'land cells')

    # Drainage area, from the sources down (reverse of the flood order).
    acc = np.where(land, cell_area, 0.0)
    accl = acc.tolist()
    for i in reversed(order):
        d = downl[i]
        if d >= 0:
            accl[d] += accl[i]
    # The largest inflow of every cell continues its river; other big inflows are tributaries.
    main_in = [-1] * N
    for i in order:
        d = downl[i]
        if d >= 0 and (main_in[d] < 0 or accl[i] > accl[main_in[d]]):
            main_in[d] = i
    label = [-1] * N
    outlet = []  # where each basin drains: its river mouth, or where it joins a bigger river
    nlab = 0
    for i in order:
        d = downl[i]
        if d < 0 or (accl[i] >= MIN_BASIN and main_in[d] != i):
            label[i] = nlab
            outlet.append(i)
            nlab += 1
        else:
            label[i] = label[d]
    label = np.array(label, dtype=np.int64).reshape(H, W)
    basin_area = np.bincount(label[label >= 0].ravel(), weights=cell_area.reshape(H, W)[label >= 0].ravel(), minlength=nlab)
    print('basins', nlab)

    relief = elev - ndimage.minimum_filter(np.where(elev > 0, elev, 0), size=RELIEF_RADIUS * 2 + 1, mode='wrap')
    high = (elev >= MIN_ELEV) & (relief >= MIN_RELIEF)
    # Height above the lowest land far around: high on a range, low on a plateau (Tibet).
    rise = elev - ndimage.minimum_filter(np.maximum(elev, 0), size=LOWLAND_RADIUS * 2 + 1, mode='wrap')

    def divide(a, b):
        """Whether the grid edge between cells a and b (flat indices) parts two basins worth keeping."""
        la, lb = label.flat[a], label.flat[b]
        if la < 0 or lb < 0 or la == lb:
            return False
        if max(basin_area[la], basin_area[lb]) >= MIN_BASIN:
            return True
        # Two little coastal basins: side by side on one coast they are parted by a spur
        # running down to the sea; draining to opposite coasts (the Apennines) by a crest.
        (ya, xa), (yb, xb) = divmod(outlet[la], W), divmod(outlet[lb], W)
        dx = min(abs(xa - xb), W - abs(xa - xb)) * km[(ya + yb) // 2]
        dy = abs(ya - yb) * km[(ya + yb) // 2]
        return math.hypot(dx, dy) > 1.3 * (math.sqrt(basin_area[la]) + math.sqrt(basin_area[lb]))

    def is_high(a, b):
        return bool(high.flat[a] or high.flat[b])

    # Divide edges on the grid lines: vertex (y, x) is the top-left corner of cell (y, x).
    adj = {}
    edge_high = {}

    def link(p, q, hi):
        adj.setdefault(p, []).append(q)
        adj.setdefault(q, []).append(p)
        edge_high[(p, q)] = edge_high[(q, p)] = hi

    for y in range(H):
        for x in range(W):
            a = y * W + x
            b = y * W + (x + 1) % W  # right neighbour: the vertical edge at x + 1
            if divide(a, b):
                link((y, x + 1), (y + 1, x + 1), is_high(a, b))
            if y + 1 < H and divide(a, a + W):  # lower neighbour: the horizontal edge at y + 1
                link((y + 1, x), (y + 1, x + 1), is_high(a, a + W))
    print('divide edges', sum(len(v) for v in adj.values()) // 2)

    # Chain edges into lines between junctions / ends.
    seen = set()
    lines = []
    def walk(start, nxt):
        path = [start, nxt]
        seen.add((start, nxt))
        seen.add((nxt, start))
        cur, prev = nxt, start
        while len(adj[cur]) == 2:
            n2 = adj[cur][0] if adj[cur][1] == prev else adj[cur][1]
            if (cur, n2) in seen:
                break
            seen.add((cur, n2))
            seen.add((n2, cur))
            path.append(n2)
            prev, cur = cur, n2
        return path

    for v, ns in adj.items():
        if len(ns) != 2:
            for n in ns:
                if (v, n) not in seen:
                    lines.append(walk(v, n))
    for v, ns in adj.items():  # closed loops
        for n in ns:
            if (v, n) not in seen:
                lines.append(walk(v, n))

    def to_lnglat(yx):
        y, x = yx
        gy = (y + r0) / size
        lng = x / size * 360 - 180
        lt = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy))))
        return lng, lt

    def smooth(pts, k=2):
        if len(pts) < 5:
            return pts
        out = [pts[0]]
        for i in range(1, len(pts) - 1):
            lo, hi = max(0, i - k), min(len(pts), i + k + 1)
            out.append((sum(p[0] for p in pts[lo:hi]) / (hi - lo), sum(p[1] for p in pts[lo:hi]) / (hi - lo)))
        out.append(pts[-1])
        return out

    def simplify(pts, tol):
        if len(pts) < 3:
            return pts
        keep_ = [False] * len(pts)
        keep_[0] = keep_[-1] = True
        stack = [(0, len(pts) - 1)]
        while stack:
            a, b = stack.pop()
            ax, ay = pts[a]
            bx, by = pts[b]
            dx, dy = bx - ax, by - ay
            L = math.hypot(dx, dy) or 1e-12
            best, bi = 0, -1
            for i in range(a + 1, b):
                d = abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / L
                if d > best:
                    best, bi = d, i
            if best > tol and bi > 0:
                keep_[bi] = True
                stack += [(a, bi), (bi, b)]
        return [p for p, k in zip(pts, keep_) if k]

    feats = []
    def sig_of(path):
        """The smaller of the two river systems a divide parts (km², the whole system upstream)."""
        (y0, x0), (y1, x1) = path[0], path[1]
        if y0 == y1:  # horizontal edge: cells above and below
            ca, cb = (y0 - 1) * W + min(x0, x1) % W, y0 * W + min(x0, x1) % W
        else:  # vertical edge: cells left and right
            ca, cb = min(y0, y1) * W + (x0 - 1) % W, min(y0, y1) * W + x0 % W
        la, lb = label.flat[ca], label.flat[cb]
        return min(accl[outlet[la]], accl[outlet[lb]]) if la >= 0 and lb >= 0 else 0

    kept = 0
    for path in lines:
        hi = [edge_high[(path[i], path[i + 1])] for i in range(len(path) - 1)]
        # Mostly over high ground: a crest. Passes inside it stay (the brush must not leak
        # through a col), the low ends where the divide runs down into a valley are trimmed.
        if not hi or sum(hi) / len(hi) < CREST_SHARE:
            continue
        a, b = hi.index(True), len(hi) - 1 - hi[::-1].index(True)
        path = path[a:b + 2]
        if len(path) - 1 < MIN_CELLS:
            continue
        if sig_of(path) < MIN_SYSTEM:
            continue
        cells = [(min(y, H - 1), x % W) for y, x in path]
        hs_ = np.array([elev[c] for c in cells])
        if np.mean([rise[c] for c in cells]) < MIN_RISE * max(1.0, float(np.mean(hs_))):
            continue
        kept += 1
        sig = sig_of(path)
        # Mean height along the crest (cells just below-right of each vertex).
        hs = [elev[min(y, H - 1), x % W] for y, x in path]
        pts = simplify(smooth([(x, y) for y, x in path], 3), 0.7)
        coords = [[round(c, 3) for c in to_lnglat((y, x))] for x, y in pts]
        # Lines crossing the antimeridian are cut there.
        parts = [[coords[0]]]
        for c in coords[1:]:
            if abs(c[0] - parts[-1][-1][0]) > 180:
                parts.append([])
            parts[-1].append(c)
        parts = [p for p in parts if len(p) >= 2]
        if not parts:
            continue
        feats.append({
            'type': 'Feature',
            'properties': {'h': int(round(float(np.mean(hs)) / 10) * 10), 'a': int(round(sig / 1000))},
            'geometry': {'type': 'MultiLineString', 'coordinates': parts},
        })
    print('crest lines', len(feats))
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', 'features': feats}, f, separators=(',', ':'))
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')


if __name__ == '__main__':
    main()
