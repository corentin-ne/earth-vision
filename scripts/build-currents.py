"""Builds public/data/currents.json: the major named surface ocean currents as GeoJSON lines.

  python scripts/build-currents.py

Source: hand-authored schematic paths (no dataset was traced), placed from general
oceanographic knowledge of the mean surface circulation as shown on standard charts (e.g. the
classic public-domain U.S. Army 1943 / Wikimedia Commons "Ocean currents" map, and Talley et
al., "Descriptive Physical Oceanography", 6th ed.). The control points below are this
project's own and are released under the project's licence; they are schematic
(mean annual position, seasonal currents such as the Somali and monsoon currents drawn in
their dominant season), not measured trajectories.
Land check: Natural Earth 1:10m land (public domain),
https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip -> .cache/ne/ne_10m_land.geojson

Each line runs in the direction of flow (first coordinate = upstream). The control points
are smoothed with a centripetal Catmull-Rom spline, resampled to ~1.2° spacing, then every
vertex is checked against the land polygons and pushed offshore when it is on land or
hugging the coast; segments that still cross land get an extra, nudged midpoint.
Longitudes are unwrapped along each line (a line crossing the antimeridian keeps going
past ±180 so it stays continuous; MapLibre draws such lines correctly).
"""
import json
import math
import os

import numpy as np
import shapely
from shapely.geometry import LineString, Point, shape
from shapely.ops import nearest_points

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAND = os.path.join(ROOT, '.cache', 'ne', 'ne_10m_land.geojson')
OUT = os.path.join(ROOT, 'public', 'data', 'currents.json')
STEP = 1.2       # resampling distance, degrees (longitude scaled by cos(latitude))
CLEAR = 0.25     # wanted distance from the coast, degrees
MIN_CLEAR = 0.06  # below this a vertex counts as "on the coast" and is moved

# name, temp, strength, control points (lon, lat) in the direction of flow
CURRENTS = [
    # ---- North Atlantic
    ('Gulf Stream', 'warm', 3, [(-79.7, 27.5), (-79.6, 30), (-78.4, 32.4), (-75.2, 35.2), (-72, 37.4),
                               (-68, 39.2), (-63, 40.2), (-57, 41), (-51, 42.2), (-45, 43.6)]),
    ('North Atlantic Drift', 'warm', 2, [(-45, 44), (-38, 46.5), (-30, 49.5), (-22, 52.5), (-15, 55.5),
                                        (-10, 58.5), (-5.5, 60.8), (-1, 62.3)]),
    ('Norwegian Current', 'warm', 2, [(-1, 62.5), (3, 63.4), (7.5, 65.6), (11.5, 68.2), (15, 70.2),
                                      (20, 71.6), (26, 72.3), (33, 72.6), (40, 73)]),
    ('West Spitsbergen Current', 'warm', 1, [(15, 71.5), (13.5, 73.5), (11.5, 75.5), (9.5, 77.5), (7, 79.3)]),
    ('East Greenland Current', 'cold', 2, [(-8, 79.5), (-12, 77), (-15.5, 74.5), (-19, 71.5), (-24.5, 68.3),
                                          (-31, 66.2), (-37, 64.2), (-41, 62), (-43, 60), (-45, 59.2)]),
    ('West Greenland Current', 'neutral', 1, [(-45.5, 59.4), (-49, 61), (-52.5, 63.5), (-55, 66.5),
                                             (-57, 69), (-60, 72), (-64, 74.5)]),
    ('Irminger Current', 'warm', 1, [(-30, 57), (-30.5, 60), (-28.5, 62.3), (-27, 64), (-26.2, 65.5),
                                     (-24.5, 66.8), (-21, 67.2)]),
    ('Labrador Current', 'cold', 2, [(-58.5, 67.5), (-60.3, 64.2), (-59.5, 61), (-57.5, 58), (-55.5, 55),
                                     (-53.5, 52.3), (-51.8, 49.5), (-50.2, 46.5), (-51, 44), (-54, 42.5)]),
    ('Canary Current', 'cold', 2, [(-14.5, 42.5), (-13, 38.5), (-12, 34.5), (-13.2, 31), (-16.5, 26.5),
                                   (-18.5, 23), (-19.2, 19.5), (-19.5, 16)]),
    ('North Equatorial Current (Atlantic)', 'warm', 2, [(-20, 14.5), (-25, 14.6), (-30, 15), (-36, 15.3),
                                                        (-42, 15.6), (-48, 16), (-54, 16.5), (-58.5, 17.2)]),
    ('Antilles Current', 'warm', 1, [(-58.5, 18.5), (-62, 20.5), (-66, 22.5), (-70, 24.2), (-73.5, 26),
                                     (-76, 28), (-78.2, 30.3)]),
    ('Caribbean Current', 'warm', 2, [(-58, 11.5), (-61.2, 11.8), (-64, 12.8), (-68, 13.6), (-72, 13.8),
                                      (-76, 14.2), (-80, 15.6), (-83, 17.4), (-85, 19.5), (-85.8, 21.6)]),
    ('Loop Current', 'warm', 2, [(-85.8, 21.8), (-86.4, 23.8), (-87, 25.6), (-86, 26.6), (-84.5, 25.8),
                                 (-83.3, 24.4), (-82.3, 24.1)]),
    ('Florida Current', 'warm', 3, [(-82.3, 24.1), (-81, 24.15), (-80.1, 24.7), (-79.75, 25.6), (-79.7, 26.6),
                                    (-79.7, 27.5)]),
    # ---- South / equatorial Atlantic
    ('North Brazil Current', 'warm', 2, [(-34.2, -5.5), (-36.5, -3.2), (-41, -1.4), (-45.5, 1),
                                         (-48.8, 3.8), (-51.8, 6.4), (-55, 7.9), (-58, 9.6), (-60, 11)]),
    ('South Equatorial Current (Atlantic)', 'warm', 2, [(9.5, -11), (5, -8.5), (0, -6), (-6, -4.5), (-12, -3.6),
                                                        (-20, -3.2), (-27, -3.6), (-31.5, -4.6), (-34.2, -5.5)]),
    ('Equatorial Counter Current (Atlantic)', 'warm', 1, [(-45, 5.5), (-40, 6.5), (-34, 7.2), (-27, 7.2),
                                                          (-20, 6.5), (-14, 5.4), (-10, 4.6)]),
    ('Guinea Current', 'warm', 1, [(-10, 4.6), (-6, 4.0), (-2, 4.2), (2, 5.0), (5, 4.6), (7, 3.6), (8.3, 2.5)]),
    ('Brazil Current', 'warm', 2, [(-34, -10), (-36.5, -14), (-37.8, -17.5), (-39, -21), (-41.2, -23.8),
                                   (-44.5, -25.7), (-47.3, -28.3), (-50, -32), (-52.5, -35.5), (-54, -38.5)]),
    ('Falklands Current', 'cold', 2, [(-62, -56.5), (-60.5, -54.5), (-57.2, -53), (-57.5, -50), (-58.5, -47),
                                      (-58, -44), (-56.5, -41), (-55, -39)]),
    ('South Atlantic Current', 'neutral', 1, [(-52, -40), (-45, -39.5), (-38, -39), (-30, -38.5), (-20, -37.5),
                                              (-10, -36.5), (0, -35.5), (8, -35), (14, -34.5)]),
    ('Benguela Current', 'cold', 2, [(17, -35.5), (15.5, -32), (14.2, -28.5), (12.6, -24.5), (11.4, -20.5),
                                     (10.5, -16.5), (10, -13)]),
    # ---- Indian Ocean
    ('Agulhas Current', 'warm', 3, [(35, -27.2), (33.3, -29.6), (31.2, -32.2), (28.6, -34.4), (25, -36),
                                    (21.5, -37.3), (18.8, -38.6), (17, -39.6)]),
    ('Agulhas Return Current', 'warm', 1, [(17, -40.2), (22, -40.6), (28, -40.3), (35, -40.3), (42, -40.8),
                                           (50, -41.5), (58, -42.5)]),
    ('Mozambique Current', 'warm', 2, [(42.5, -12.3), (42, -15.5), (41, -18.5), (39.2, -21.5), (37, -24.5),
                                       (35.3, -26.6)]),
    ('East Madagascar Current', 'warm', 1, [(51, -15), (50.6, -18), (49.8, -21), (48.6, -24), (46.5, -26.4),
                                            (44, -28)]),
    ('South Equatorial Current (Indian)', 'warm', 2, [(115, -12), (108, -12.8), (100, -13.5), (90, -14.5),
                                                      (80, -15), (70, -15), (62, -14.2), (56, -13), (52, -12),
                                                      (50, -11.2)]),
    ('East African Coast Current', 'warm', 1, [(50, -11), (46.5, -10.4), (43, -9.2), (41, -6.8), (41.2, -4),
                                               (42.5, -1.6)]),
    ('Somali Current', 'warm', 2, [(42.5, -1.6), (45.5, 1.2), (48.5, 4.6), (51, 8), (52.5, 11), (55.5, 13.6),
                                   (58.5, 16.2), (60.5, 18.5)]),
    ('Southwest Monsoon Current', 'warm', 1, [(56, 9), (62, 8.5), (68, 7.2), (75, 5.2), (78.5, 4.7), (81.5, 5.0),
                                              (84.5, 6.5), (87, 9), (89.5, 12)]),
    ('Northeast Monsoon Current', 'neutral', 1, [(94, 5.6), (90, 5.2), (85, 4.7), (81, 4.6), (77, 5.2),
                                                 (72, 5.6), (66, 5.6), (59, 5.2), (53, 4.4)]),
    ('Equatorial Counter Current (Indian)', 'warm', 1, [(50, -3.5), (56, -4), (63, -4.4), (70, -4.6), (78, -4.6),
                                                        (86, -4.2), (93, -3.6), (97, -3.2)]),
    ('South Indian Current', 'neutral', 1, [(55, -40), (65, -38.8), (75, -37.8), (85, -37), (95, -36.3),
                                            (105, -35.6)]),
    ('West Australian Current', 'cold', 1, [(106, -36), (108, -32.5), (108.6, -28.5), (108, -24), (106, -19.5),
                                            (102, -15.5)]),
    ('Leeuwin Current', 'warm', 1, [(113.6, -21.5), (112.6, -24.5), (113.2, -28), (114.4, -31.5),
                                    (114.6, -34.6), (116.5, -35.6), (120, -35), (124, -34.5), (128.5, -33),
                                    (133, -33.5)]),
    ('Indonesian Throughflow', 'warm', 2, [(126, 5.5), (123.5, 3.5), (120.5, 2.2), (119, 0), (118.3, -2.3),
                                           (117.9, -4.6), (116.6, -6.4), (115.9, -8.0), (115.85, -9.2),
                                           (115, -11), (112, -12.3)]),
    # ---- Pacific
    ('North Equatorial Current (Pacific)', 'warm', 2, [(-117, 19), (-125, 16), (-135, 14), (-145, 13),
                                                       (-155, 13), (-165, 13), (-175, 13), (175, 13),
                                                       (165, 12.6), (155, 12.4), (146, 12.4), (138, 13),
                                                       (131, 13.5), (127, 14)]),
    ('Kuroshio', 'warm', 3, [(124, 15.5), (123.6, 18.5), (122.9, 21.5), (122.35, 24.2), (123.8, 26.6),
                             (126, 28.4), (128.7, 29.5), (131.7, 30.3), (133.2, 31.9), (134.6, 32.9),
                             (136.5, 33.3), (138.6, 33.9), (140.6, 34.6), (142, 35.3)]),
    ('Kuroshio Extension', 'warm', 2, [(142, 35.3), (146, 35.8), (150, 36.1), (154, 36.6), (158, 37.3)]),
    ('Tsushima Current', 'warm', 1, [(126.5, 30), (127.8, 32.3), (128.9, 34.35), (130.4, 35.6), (133, 36.8),
                                     (135.5, 37.9), (137.5, 39.1), (139.1, 40.6), (139.3, 41.7)]),
    ('Oyashio', 'cold', 2, [(164.5, 57), (164, 54.8), (161.5, 52.3), (158, 49.6), (154.5, 47), (150.5, 44.4),
                            (146.6, 42.6), (143.8, 41), (142.6, 39.3), (142, 37.6), (142.4, 36.4)]),
    ('North Pacific Current', 'neutral', 2, [(158, 37.6), (165, 38.8), (172, 40), (180, 41), (-170, 42),
                                             (-160, 43), (-150, 44), (-140, 45), (-132, 46)]),
    ('California Current', 'cold', 2, [(-130, 47.5), (-127.6, 44), (-126, 40.3), (-124.5, 37), (-122.4, 33.8),
                                       (-119.8, 30.5), (-117, 26), (-115.6, 22.2), (-117, 19)]),
    ('Alaska Current', 'warm', 1, [(-132, 47), (-135, 51.5), (-138, 55.5), (-141.5, 58.4), (-145.5, 59.2),
                                   (-148.5, 58.8), (-150.6, 57.6), (-152.8, 56), (-156, 55), (-160, 54.2),
                                   (-165, 53.2), (-170, 51.9), (-176, 51.1)]),
    ('Aleutian Current', 'neutral', 1, [(165, 47.5), (172, 48.5), (180, 49.3), (-172, 50), (-164, 50.6),
                                        (-156, 51.4), (-148, 52.2)]),
    ('Mindanao Current', 'warm', 1, [(127, 13), (127.3, 10.5), (127.2, 8), (126.9, 6), (127.3, 4.5),
                                     (128.4, 4.2), (129.5, 4.8)]),
    ('Equatorial Counter Current (Pacific)', 'warm', 2, [(129.5, 5), (135, 5.6), (142, 6), (150, 6.4),
                                                         (160, 6.6), (170, 7), (180, 7.2), (-170, 7.2),
                                                         (-160, 7), (-150, 7), (-140, 7.2), (-130, 7.5),
                                                         (-120, 8), (-110, 8.2), (-100, 8), (-92, 7.4),
                                                         (-87, 7.6)]),
    ('South Equatorial Current (Pacific)', 'warm', 2, [(-86, -1.6), (-92.5, -2.3), (-100, -2), (-110, -1.6),
                                                       (-120, -1.6), (-130, -2), (-140, -2.6), (-150, -3.2),
                                                       (-160, -4), (-170, -5), (180, -6), (172, -7.5),
                                                       (166, -9.5)]),
    ('Humboldt Current', 'cold', 2, [(-77, -45), (-75.3, -40), (-74, -35), (-73, -30), (-72, -25),
                                     (-72, -20.5), (-75.6, -16.5), (-78.8, -12.5), (-81.4, -8.5),
                                     (-82.6, -5.2), (-84.5, -2.8), (-86, -1.6)]),
    ('South Pacific Current', 'neutral', 1, [(-174, -45.5), (-165, -45.4), (-155, -45), (-145, -44.5),
                                             (-130, -44), (-115, -43.5), (-100, -43.2), (-88, -44), (-80, -45)]),
    ('East Australian Current', 'warm', 2, [(155.5, -17), (155, -21.5), (154.4, -25.5), (154, -28.8),
                                            (153.8, -31.4), (152.6, -34), (151.6, -36.5), (151.2, -38.6)]),
    # ---- Southern Ocean (Antarctic Circumpolar Current, three ocean segments)
    ('Antarctic Circumpolar Current (Pacific)', 'cold', 3, [(150, -54.5), (160, -56), (170, -57.5), (180, -59),
                                                             (-170, -60), (-160, -60.2), (-150, -60), (-140, -59.6),
                                                             (-130, -59), (-120, -58.5), (-110, -58.2),
                                                             (-100, -58.2), (-90, -58.2), (-80, -58.2),
                                                             (-70, -58.2), (-64, -57.8)]),
    ('Antarctic Circumpolar Current (Atlantic)', 'cold', 3, [(-64, -57.8), (-56, -57.2), (-47, -56.2),
                                                              (-39, -56.2), (-30, -55), (-20, -53), (-10, -51),
                                                              (0, -50), (10, -49), (20, -48.3)]),
    ('Antarctic Circumpolar Current (Indian)', 'cold', 3, [(20, -48.3), (30, -48), (40, -48.2), (50, -48.8),
                                                            (60, -50), (67, -51.6), (74, -51.4), (85, -50.2),
                                                            (100, -49.2), (115, -48.5), (130, -49.5), (140, -51.5),
                                                            (150, -54.5)]),
]


def unwrap(pts):
    out = [list(pts[0])]
    for lon, lat in pts[1:]:
        prev = out[-1][0]
        lon = lon + 360 * round((prev - lon) / 360)
        out.append([lon, lat])
    return np.array(out, dtype=np.float64)


def catmull_rom(p, per_seg=24, alpha=0.5):
    """Centripetal Catmull-Rom through all the points (ends extended by reflection)."""
    p = np.vstack([2 * p[0] - p[1], p, 2 * p[-1] - p[-2]])
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        t0 = 0.0
        t1 = t0 + max(np.linalg.norm(p1 - p0), 1e-6) ** alpha
        t2 = t1 + max(np.linalg.norm(p2 - p1), 1e-6) ** alpha
        t3 = t2 + max(np.linalg.norm(p3 - p2), 1e-6) ** alpha
        for t in np.linspace(t1, t2, per_seg, endpoint=False):
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    out.append(p[-2])
    return np.array(out)


def resample(line, step=STEP):
    """Evenly spaced vertices (longitude distances scaled by cos latitude), keeping both ends."""
    d = np.diff(line, axis=0)
    d[:, 0] *= np.cos(np.radians((line[1:, 1] + line[:-1, 1]) / 2))
    s = np.concatenate([[0], np.cumsum(np.hypot(d[:, 0], d[:, 1]))])
    n = max(2, int(math.ceil(s[-1] / step)) + 1)
    t = np.linspace(0, s[-1], n)
    return np.column_stack([np.interp(t, s, line[:, 0]), np.interp(t, s, line[:, 1])])


def wrap(lon):
    return (lon + 180) % 360 - 180


class Land:
    def __init__(self):
        with open(LAND, encoding='utf-8') as f:
            fc = json.load(f)
        polys = []
        for feat in fc['features']:
            g = shape(feat['geometry'])
            polys.extend(g.geoms if g.geom_type == 'MultiPolygon' else [g])
        self.polys = polys
        self.tree = shapely.STRtree(polys)

    def nearest(self, x, y):
        """(distance, nearest land point, inside?) for a point in -180..180."""
        p = Point(x, y)
        idx = self.tree.query_nearest(p, max_distance=2.0)
        if len(idx) == 0:
            return 99.0, None, False
        poly = self.polys[idx[0]]
        inside = poly.contains(p)
        q = nearest_points(poly.exterior if inside else poly, p)[0]
        return p.distance(q) if not inside else 0.0, q, inside

    def crosses(self, a, b):
        seg = LineString([(wrap(a[0]), a[1]), (wrap(a[0]) + (b[0] - a[0]), b[1])])
        return any(self.polys[i].intersects(seg) for i in self.tree.query(seg))


def push_offshore(land, lon, lat):
    """Moves a vertex off land / away from the coast. Returns the new (lon, lat) and whether it moved."""
    moved = False
    x = wrap(lon)
    off = lon - x
    for attempt in range(8):
        dist, q, inside = land.nearest(x, lat)
        if not inside and dist >= MIN_CLEAR:
            break
        want = CLEAR / (1 + attempt * 0.5)
        v = np.array([x - q.x, lat - q.y])
        n = np.linalg.norm(v)
        if n < 1e-9:  # exactly on the boundary: step toward the sea by probing
            v, n = np.array([1.0, 0.0]), 1.0
        v /= n
        if inside:
            v = -v  # the coast point lies outward from an inland vertex
        x, lat = q.x + v[0] * want, q.y + v[1] * want
        moved = True
    return x + off, lat, moved


def main():
    land = Land()
    feats, fixed, inserted, total, still = [], 0, 0, 0, []
    for name, temp, strength, pts in CURRENTS:
        line = resample(catmull_rom(unwrap(pts)))
        out = []
        for lon, lat in line:
            lon, lat, moved = push_offshore(land, lon, lat)
            fixed += moved
            out.append([lon, lat])
        # Segments that still clip a cape: add a nudged midpoint (a few rounds).
        for _ in range(4):
            new, any_ins = [out[0]], False
            for a, b in zip(out, out[1:]):
                if land.crosses(a, b):
                    mx, my, _m = push_offshore(land, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                    new.append([mx, my])
                    inserted += 1
                    any_ins = True
                new.append(b)
            out = new
            if not any_ins:
                break
        bad = sum(land.crosses(a, b) for a, b in zip(out, out[1:]))
        if bad:
            still.append((name, [b for a, b in zip(out, out[1:]) if land.crosses(a, b)]))
        shift = 360 * round(-out[0][0] / 360) if abs(out[0][0]) > 180 else 0
        coords = [[round(x + shift, 2), round(y, 2)] for x, y in out]
        total += len(coords)
        feats.append({'type': 'Feature', 'properties': {'name': name, 'temp': temp, 'strength': strength},
                      'geometry': {'type': 'LineString', 'coordinates': coords}})
    fc = {'type': 'FeatureCollection', 'features': feats}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(fc, f, separators=(',', ':'))
    print(f'currents {len(feats)} lines, {total} vertices, {fixed} vertices pushed offshore, '
          f'{inserted} midpoints inserted, {os.path.getsize(OUT) / 1e3:.0f} KB')
    print('  segments still crossing land:', still or 'none')
    by_temp = {}
    for f in feats:
        by_temp[f['properties']['temp']] = by_temp.get(f['properties']['temp'], 0) + 1
    print('  by temp', by_temp)
    for f in feats:
        c = f['geometry']['coordinates']
        print(f"  {f['properties']['name']:45s} {len(c):3d} pts  {c[0]} -> {c[-1]}")


if __name__ == '__main__':
    main()
