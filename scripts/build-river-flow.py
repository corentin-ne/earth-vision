"""Builds public/data/rivers-flow.json: the map's rivers cut at every confluence, each piece
carrying how much river drains through it, so the map can draw them at their real width.

  python scripts/build-river-flow.py

Natural Earth gives no discharge, but a river's flow grows with the length of the river
network upstream of it (Hack's law), which the network itself tells:
- every line is turned to run downhill (elevation at both ends, from the raw DEM tiles);
- a line whose lower end touches another line drains into it there (a confluence);
- walking the network from the sources down, each point's `flow` is the length (km) of all
  river upstream of it; a river is cut wherever a tributary joins, so its width steps up there.
Lines whose lower end touches nothing are mouths (the sea, a lake, the desert).
"""
import importlib.util
import json
import math
import os
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('rasters', os.path.join(HERE, 'build-rasters.py'))
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)
ROOT = os.path.dirname(HERE)

Z = 5
SNAP = 0.04  # degrees: a lower end this close to another line joins it
_tiles = {}


def elevation(lng, lat):
    n = 1 << Z
    x = (lng + 180) / 360 * n
    lat = max(-85, min(85, lat))
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    tx, ty = int(x) % n, min(n - 1, max(0, int(y)))
    key = (tx, ty)
    if key not in _tiles:
        p = os.path.join(R.CACHE, 'dem', str(Z), str(tx), f'{ty}.png')
        _tiles[key] = R.read_elev(p) if os.path.exists(p) else np.zeros((256, 256))
    t = _tiles[key]
    return float(t[min(255, int((y - int(y)) * 256)), min(255, int((x - int(x)) * 256))])


def km(a, b):
    la = math.radians((a[1] + b[1]) / 2)
    return math.hypot((b[0] - a[0]) * math.cos(la), b[1] - a[1]) * 111.32


def main():
    with open(os.path.join(ROOT, 'public', 'data', 'rivers.json'), encoding='utf-8') as f:
        fc = json.load(f)
    lines = []  # (coords, name, scalerank)
    for feat in fc['features']:
        g = feat['geometry']
        if not g:
            continue
        parts = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
        for c in parts:
            if len(c) >= 2:
                lines.append([[float(c[i][0]), float(c[i][1])] for i in range(len(c))])
                lines[-1] = (lines[-1], feat['properties'].get('name'), feat['properties'].get('scalerank'))
    # Downhill: the end with the lower ground last (ties: keep the drawn order).
    oriented = []
    for c, name, rank in lines:
        hs = [elevation(*p) for p in (c[0], c[-1])]
        if hs[0] < hs[1] - 1:
            c = c[::-1]
        oriented.append((c, name, rank))

    # Spatial index of every vertex: grid cells of SNAP degrees.
    grid = defaultdict(list)
    for li, (c, _, _) in enumerate(oriented):
        for vi, p in enumerate(c):
            grid[(int(p[0] // SNAP), int(p[1] // SNAP))].append((li, vi))

    def joins(li):
        """Where line li's lower end meets another line: (line, vertex) or None."""
        end = oriented[li][0][-1]
        gx, gy = int(end[0] // SNAP), int(end[1] // SNAP)
        best, bd = None, SNAP
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for lj, vj in grid[(gx + dx, gy + dy)]:
                    if lj == li:
                        continue
                    q = oriented[lj][0][vj]
                    d = math.hypot(q[0] - end[0], q[1] - end[1])
                    # Joining at the other line's own lower end is two rivers meeting at a mouth.
                    if d < bd and vj < len(oriented[lj][0]) - 1:
                        best, bd = (lj, vj), d
        return best

    parent = {li: joins(li) for li in range(len(oriented))}
    children = defaultdict(list)
    for li, j in parent.items():
        if j:
            children[j[0]].append((j[1], li))

    # Upstream length, sources first; a cycle (bad data) is broken by ignoring its back edge.
    total = {}
    state = {}
    order = []

    def visit(li):
        stack = [(li, False)]
        while stack:
            node, done = stack.pop()
            if done:
                state[node] = 2
                order.append(node)
                continue
            if state.get(node):
                continue
            state[node] = 1
            stack.append((node, True))
            for _, ch in children[node]:
                if not state.get(ch):
                    stack.append((ch, False))

    for li in range(len(oriented)):
        visit(li)
    features = []
    for li in order:
        c, name, rank = oriented[li]
        inflow = defaultdict(float)
        for vi, ch in children[li]:
            inflow[vi] += total.get(ch, 0)
        flow = inflow.get(0, 0.0)
        piece = [c[0]]
        for vi in range(1, len(c)):
            flow += km(c[vi - 1], c[vi])
            piece.append(c[vi])
            if inflow.get(vi) or vi == len(c) - 1:
                features.append({'type': 'Feature', 'properties': {'name': name, 'scalerank': rank, 'flow': round(flow)}, 'geometry': {'type': 'LineString', 'coordinates': piece}})
                flow += inflow.get(vi, 0)
                piece = [c[vi]]
        total[li] = flow
    out = {'type': 'FeatureCollection', 'features': features}
    with open(os.path.join(ROOT, 'public', 'data', 'rivers-flow.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    big = sorted(((f['properties']['flow'], f['properties']['name'] or '') for f in features), reverse=True)
    seen, top = set(), []
    for fl, n in big:
        if n not in seen:
            seen.add(n)
            top.append((n, fl))
        if len(top) == 12:
            break
    print('pieces', len(features), 'top', top)


if __name__ == '__main__':
    main()
