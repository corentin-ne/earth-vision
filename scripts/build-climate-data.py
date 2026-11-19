"""Builds the thematic layers (night lights, climate zones, winds, historical cities).

  python scripts/build-climate-data.py [lights] [climate] [winds] [cities]

Raw sources go in .cache/<name>/ (git-ignored); download them first (commands below).

- lights -> public/tiles/lights/{z}/{x}/{y}.webp (z0-5, 256 px, RGBA: warm glow, alpha = brightness)
  Source: NASA Earth Observatory, "Earth at Night (Black Marble) 2016", grayscale 3 km map
  (VIIRS DNB composite). Licence: NASA imagery, public domain (credit "NASA Earth Observatory").
  URL: https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144897/BlackMarble_2016_3km_gray.jpg
  (page: https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/ — the old
  eoimages.gsfc.nasa.gov host no longer answers) -> .cache/lights/

- climate -> public/tiles/climate/{z}/{x}/{y}.png (z0-4, 256 px, paletted) + public/data/climate-legend.json
  Source: Beck, H.E. et al. (2018) "Present and future Köppen-Geiger climate classification maps
  at 1-km resolution", Scientific Data 5:180214, present-day (1980-2016) map at 0.0833°.
  Licence: CC BY 4.0. URL: https://ndownloader.figshare.com/files/12407516 (Beck_KG_V1.zip,
  figshare article 6396959) -> .cache/koppen/, extract Beck_KG_V1_present_0p083.tif

- winds -> public/data/winds.json (2° grid, annual mean 10 m wind)
  Source: NCEP/NCAR Reanalysis 1 long-term monthly means 1991-2020, surface (T62 Gaussian grid),
  NOAA PSL. Licence: public domain (US Government data; credit "NCEP/NCAR Reanalysis, NOAA PSL").
  URLs: https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.derived/surface_gauss/uwnd.10m.mon.ltm.1991-2020.nc
        https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.derived/surface_gauss/vwnd.10m.mon.ltm.1991-2020.nc
  -> .cache/winds/ (NetCDF4/HDF5, read with h5py). The 12 months are averaged.

- cities -> public/data/cities-history.json
  Source: Reba, M., Reitsma, F. & Seto, K.C. (2016) "Spatializing 6,000 years of global
  urbanization from 3700 BC to AD 2000", Scientific Data 3:160034 (Chandler 1987 + Modelski 2003
  tables, geocoded). Licence: CC BY 4.0. URLs (figshare V2 files):
    https://ndownloader.figshare.com/files/5407640  chandlerV2.csv        (article 2059494)
    https://ndownloader.figshare.com/files/5356132  modelskiAncientV2.csv (article 2059497)
    https://ndownloader.figshare.com/files/5407637  modelskiModernV2.csv  (article 2059500)
  -> .cache/cities/
"""
import csv
import importlib.util
import json
import math
import os
import shutil
import sys
import unicodedata

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.cache')
TILES = os.path.join(ROOT, 'public', 'tiles')
DATA = os.path.join(ROOT, 'public', 'data')
TILE = 256

_spec = importlib.util.spec_from_file_location('build_rasters', os.path.join(ROOT, 'scripts', 'build-rasters.py'))
rasters = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rasters)
merc_lat, polar_weight = rasters.merc_lat, rasters.polar_weight


def merc_y(lat):
    """Web Mercator y in 0..1 (top = north) of a latitude."""
    s = math.sin(math.radians(lat))
    return 0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)


def lonlat_px(lon, lat, z):
    world = TILE << z
    return int((lon + 180) / 360 * world), int(merc_y(lat) * world)


def to_mercator(src, world):
    """Nearest-neighbour reprojection of a whole-world equirectangular array to a
    world × world Web Mercator array."""
    h, w = src.shape[:2]
    sx = np.clip(((np.arange(world) + 0.5) / world * w).astype(np.int32), 0, w - 1)
    lat = merc_lat((np.arange(world) + 0.5) / world)
    sy = np.clip(((90 - lat) / 180 * h).astype(np.int32), 0, h - 1)
    return src[sy[:, None], sx[None, :]], lat


def clear(dest):
    shutil.rmtree(dest, ignore_errors=True)
    os.makedirs(dest, exist_ok=True)


def dir_size(path):
    return sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(path) for f in fs)


# ---------------------------------------------------------------- night lights
LIGHTS_Z = 5
GLOW = np.array([0xff, 0xd8, 0x8a], dtype=np.float32)


def lights_rgba(alpha):
    """Warm glow, whitening at the brightest; alpha carries the brightness."""
    a = alpha.astype(np.float32) / 255
    t = np.clip((a - 0.55) / 0.45, 0, 1)[..., None] ** 1.5
    rgb = GLOW * (1 - t) + 255 * t
    return np.dstack([np.clip(rgb + 0.5, 0, 255).astype(np.uint8), alpha])


def build_lights():
    src = Image.open(os.path.join(CACHE, 'lights', 'BlackMarble_2016_3km_gray.jpg')).convert('L')
    world = TILE << LIGHTS_Z
    # Area-average to the target scale first (the 3 km source is finer than z5 at the equator).
    eq = np.asarray(src.resize((world, world // 2), Image.BOX), dtype=np.float32) / 255
    del src
    # Threshold: lifts out the JPEG/ocean floor, airglow and aurora speckle (all < ~0.1),
    # then a gamma that keeps small towns visible but faint.
    v = np.clip((eq - 0.10) / 0.80, 0, 1) ** 1.35
    merc, lat = to_mercator(v, world)
    merc *= (1 - polar_weight(lat))[:, None]  # nothing to show at the caps; avoids streaks
    alpha = np.clip(merc * 255 + 0.5, 0, 255).astype(np.uint8)
    del merc, v, eq

    dest = os.path.join(TILES, 'lights')
    clear(dest)
    empty = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    big = Image.fromarray(alpha, 'L')
    count = 0
    for z in range(LIGHTS_Z, -1, -1):
        size = TILE << z
        a = np.asarray(big if size == world else big.resize((size, size), Image.BOX))
        if z < LIGHTS_Z:
            # Averaging thins the glow at low zooms (a city becomes a dim sub-pixel), so lift it
            # back with a gamma that grows with every zoom level out.
            a = np.clip(255 * (a / 255.0) ** (0.82 ** (LIGHTS_Z - z)) + 0.5, 0, 255).astype(np.uint8)
        n = 1 << z
        for x in range(n):
            d = os.path.join(dest, str(z), str(x))
            os.makedirs(d, exist_ok=True)
            for y in range(n):
                ta = a[y * TILE:(y + 1) * TILE, x * TILE:(x + 1) * TILE]
                path = os.path.join(d, f'{y}.webp')
                if ta.max() < 3:
                    empty.save(path, 'WEBP', lossless=True)
                else:
                    Image.fromarray(lights_rgba(ta), 'RGBA').save(path, 'WEBP', quality=70, alpha_quality=80, method=6)
                count += 1
    print('lights tiles', count, 'size %.2f MB' % (dir_size(dest) / 1e6))

    # Sanity: mean alpha in a small box around a few places at z4.
    a4 = np.asarray(big.resize((TILE << 4, TILE << 4), Image.BOX)).astype(np.float32)
    for name, lon, lat in [('Tokyo', 139.7, 35.7), ('Paris', 2.35, 48.86), ('New York', -74.0, 40.7),
                           ('Cairo', 31.24, 30.04), ('Sahara (Algeria)', 2.0, 24.0), ('Pacific', -150, 0),
                           ('Amazon', -63, -5), ('Siberia', 105, 65)]:
        px, py = lonlat_px(lon, lat, 4)
        print(f'  lights {name:18s} alpha max {a4[py - 3:py + 4, px - 3:px + 4].max():5.0f}')


# ---------------------------------------------------------------- climate
KOPPEN = [  # value in the Beck map, code, name, colour
    (1, 'Af', 'Tropical rainforest', '#0000FF'),
    (2, 'Am', 'Tropical monsoon', '#0078FF'),
    (3, 'Aw', 'Tropical savanna', '#46AAFA'),
    (4, 'BWh', 'Hot desert', '#FF0000'),
    (5, 'BWk', 'Cold desert', '#FF9696'),
    (6, 'BSh', 'Hot steppe', '#F5A500'),
    (7, 'BSk', 'Cold steppe', '#FFDC64'),
    (8, 'Csa', 'Mediterranean, hot summer', '#FFFF00'),
    (9, 'Csb', 'Mediterranean, warm summer', '#C8C800'),
    (10, 'Csc', 'Mediterranean, cold summer', '#969600'),
    (11, 'Cwa', 'Humid subtropical, dry winter', '#96FF96'),
    (12, 'Cwb', 'Subtropical highland, dry winter', '#64C864'),
    (13, 'Cwc', 'Subpolar oceanic, dry winter', '#329632'),
    (14, 'Cfa', 'Humid subtropical', '#C8FF50'),
    (15, 'Cfb', 'Oceanic', '#64FF50'),
    (16, 'Cfc', 'Subpolar oceanic', '#32C800'),
    (17, 'Dsa', 'Continental, dry hot summer', '#FF00FF'),
    (18, 'Dsb', 'Continental, dry warm summer', '#C800C8'),
    (19, 'Dsc', 'Subarctic, dry summer', '#963296'),
    (20, 'Dsd', 'Subarctic, dry summer, severe winter', '#966496'),
    (21, 'Dwa', 'Continental, dry winter, hot summer', '#AAAFFF'),
    (22, 'Dwb', 'Continental, dry winter, warm summer', '#5A78DC'),
    (23, 'Dwc', 'Subarctic, dry winter', '#4B50B4'),
    (24, 'Dwd', 'Subarctic, dry winter, severe winter', '#320087'),
    (25, 'Dfa', 'Humid continental, hot summer', '#00FFFF'),
    (26, 'Dfb', 'Humid continental, warm summer', '#37C8FF'),
    (27, 'Dfc', 'Subarctic', '#007D7D'),
    (28, 'Dfd', 'Subarctic, severe winter', '#00465F'),
    (29, 'ET', 'Tundra', '#B2B2B2'),
    (30, 'EF', 'Ice cap', '#666666'),
]
CLIMATE_Z = 4


def build_climate():
    src = np.asarray(Image.open(os.path.join(CACHE, 'koppen', 'Beck_KG_V1_present_0p083.tif')))
    palette = [0, 0, 0]
    for _, _, _, c in KOPPEN:
        palette += [int(c[i:i + 2], 16) for i in (1, 3, 5)]
    palette += [0, 0, 0] * (256 - len(palette) // 3)
    trns = bytes([0] + [255] * len(KOPPEN))

    dest = os.path.join(TILES, 'climate')
    clear(dest)
    count = 0
    for z in range(CLIMATE_Z + 1):
        world = TILE << z
        merc, _ = to_mercator(src, world)  # categorical: nearest neighbour at every zoom
        n = 1 << z
        for x in range(n):
            d = os.path.join(dest, str(z), str(x))
            os.makedirs(d, exist_ok=True)
            for y in range(n):
                t = merc[y * TILE:(y + 1) * TILE, x * TILE:(x + 1) * TILE]
                if not t.any():
                    t = t[:16, :16]  # open sea: tiny transparent tile, no 404s
                img = Image.fromarray(np.ascontiguousarray(t), 'P')
                img.putpalette(palette)
                img.save(os.path.join(d, f'{y}.png'), optimize=True, transparency=trns)
                count += 1
    print('climate tiles', count, 'size %.2f MB' % (dir_size(dest) / 1e6))

    present = set(np.unique(src).tolist())
    legend = [{'code': code, 'name': name, 'color': color} for v, code, name, color in KOPPEN if v in present]
    with open(os.path.join(DATA, 'climate-legend.json'), 'w', encoding='utf-8') as f:
        json.dump(legend, f, ensure_ascii=False, indent=1)
    print('climate legend classes', len(legend))

    h, w = src.shape
    codes = {v: code for v, code, _, _ in KOPPEN}
    for name, lon, lat in [('Paris', 2.35, 48.86), ('Cairo', 31.24, 30.04), ('Moscow', 37.62, 55.75),
                           ('Manaus', -60.02, -3.1), ('Rome', 12.5, 41.9), ('Singapore', 103.8, 1.35),
                           ('Yakutsk', 129.7, 62.03), ('Mid-Atlantic', -30, 30)]:
        v = src[int((90 - lat) / 180 * h), int((lon + 180) / 360 * w)]
        print(f'  climate {name:12s} {codes.get(int(v), "sea/none")}')


# ---------------------------------------------------------------- winds
WIND_RES = 2.0


def build_winds():
    import h5py
    comps = {}
    for var in ('uwnd', 'vwnd'):
        with h5py.File(os.path.join(CACHE, 'winds', f'{var}.10m.mon.ltm.1991-2020.nc'), 'r') as f:
            d = f[var]
            a = d[...].astype(np.float64) * float(d.attrs['scale_factor'][0]) + float(d.attrs['add_offset'][0])
            a = np.where(np.abs(a) > 1e3, np.nan, a)
            comps[var] = np.nanmean(a, axis=0)  # annual mean of the 12 monthly means
            lat = f['lat'][...].astype(np.float64)  # 88.5 .. -88.5 (Gaussian)
            lon = f['lon'][...].astype(np.float64)  # 0 .. 358.125
    nx, ny = int(360 / WIND_RES), int(180 / WIND_RES) + 1
    out_lon = -180 + np.arange(nx) * WIND_RES
    out_lat = 90 - np.arange(ny) * WIND_RES

    # Bilinear: periodic in longitude, clamped beyond the outermost Gaussian rows.
    fx = ((out_lon % 360) - lon[0]) / (lon[1] - lon[0])
    x0 = np.floor(fx).astype(int) % len(lon)
    x1 = (x0 + 1) % len(lon)
    tx = fx - np.floor(fx)
    asc = lat[::-1]
    fy = np.interp(out_lat, asc, np.arange(len(asc)))  # index in ascending order (clamped)
    y0 = np.floor(fy).astype(int)
    y1 = np.minimum(y0 + 1, len(asc) - 1)
    ty = fy - y0

    def sample(field):
        g = field[::-1]
        a = g[y0][:, x0] * (1 - tx) + g[y0][:, x1] * tx
        b = g[y1][:, x0] * (1 - tx) + g[y1][:, x1] * tx
        return a * (1 - ty)[:, None] + b * ty[:, None]

    u, v = sample(comps['uwnd']), sample(comps['vwnd'])
    rnd = lambda a: [round(float(x), 1) + 0.0 for x in a.ravel()]
    out = {'source': 'NCEP/NCAR Reanalysis 1, 10 m wind, annual mean of 1991-2020 monthly long-term means (NOAA PSL)',
           'nx': nx, 'ny': ny, 'lo1': -180, 'la1': 90, 'dx': WIND_RES, 'dy': WIND_RES,
           'u': rnd(u), 'v': rnd(v)}
    path = os.path.join(DATA, 'winds.json')
    with open(path, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('winds', nx, 'x', ny, '%.0f KB' % (os.path.getsize(path) / 1e3))

    def at(lo, la):
        i, j = int(round((90 - la) / WIND_RES)), int(round((lo + 180) / WIND_RES)) % nx
        return u[i, j], v[i, j]
    print('  winds zonal mean u at 45S %.1f, 50S %.1f, 15N (trades) %.1f, 0 %.1f, 45N %.1f m/s' % tuple(
        u[int(round((90 - la) / WIND_RES))].mean() for la in (-45, -50, 15, 0, 45)))
    for name, lo, la in [('Southern Ocean 90E 50S', 90, -50), ('Trade winds 40W 15N', -40, 15),
                         ('N Atlantic 30W 50N', -30, 50)]:
        print('  winds %-24s u=%.1f v=%.1f' % ((name,) + at(lo, la)))


# ---------------------------------------------------------------- cities
def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return ''.join(ch for ch in s if ch.isalnum())


# Values in the source that are plainly wrong and are dropped rather than guessed at:
# Modelski gives Montevideo 13,303,000 in AD 2000 (Chandler: 1,430,000 in 1975; real ~1.3 M).
ERRATA = {('Montevideo', 'modelskiModernV2.csv'): (2000,)}
COUNTRY_FIX = {'Uraguay': 'Uruguay'}


def read_table(name):
    with open(os.path.join(CACHE, 'cities', name), encoding='latin-1', newline='') as f:
        rows = list(csv.reader(f))
    head = rows[0]
    years = [(-int(h[3:]) if h.startswith('BC_') else int(h[3:])) for h in head[6:]]
    out = []
    for r in rows[1:]:
        if len(r) < 6 or not r[0].strip():
            continue
        try:
            lat, lng = float(r[3].strip('  ')), float(r[4].strip('  '))
        except ValueError:
            continue
        pops = {}
        for y, val in zip(years, r[6:]):
            val = val.strip().replace(',', '')
            if val and val.upper() != 'NA':
                try:
                    p = float(val)
                except ValueError:
                    continue
                if p > 0:
                    pops[y] = int(round(p))
        for y in ERRATA.get((r[0].strip(), name), ()):
            pops.pop(y, None)
        country = COUNTRY_FIX.get(r[2].strip(), r[2].strip())
        out.append({'n': r[0].strip(), 'alt': r[1].strip(), 'c': country, 'lat': lat, 'lng': lng, 'p': pops})
    return out


def fix_text(s):
    """The CSVs are mostly ASCII with a few cp1252/UTF-8 names; repair mojibake if any."""
    try:
        return s.encode('latin-1').decode('utf-8')
    except (UnicodeDecodeError, UnicodeEncodeError):
        return s


def build_cities():
    # Chandler first: on years both tables give, Chandler's value is kept and Modelski fills gaps.
    sources = [('chandler', read_table('chandlerV2.csv')), ('modelskiAncient', read_table('modelskiAncientV2.csv')),
               ('modelskiModern', read_table('modelskiModernV2.csv'))]
    merged, conflicts, dup_rows = [], 0, 0
    index = {}  # (country, name key) -> merged entry
    for src_name, rows in sources:
        for r in rows:
            if not r['p']:
                continue
            # The OtherName column mixes former names with states/provinces ("Albany" -> "New York"),
            # so a former name only matches a row at practically the same spot.
            key = norm(r['n'])
            alts = {norm(a) for a in r['alt'].replace('/', ',').split(',') if norm(a)}
            near = lambda m, d: abs(m['lat_raw'] - r['lat']) < d and abs(m['lng_raw'] - r['lng']) < d
            hit = next((m for m in index.get(key, []) if near(m, 1.5)), None)
            if hit is None:
                hit = next((m for k in alts for m in index.get(k, []) if near(m, 0.3)), None)
            if hit is None:
                hit = next((m for m in merged if key in m['keys'] | m['alts'] and near(m, 0.3)), None)
            if hit is None:  # same spot (~3 km) under another spelling
                hit = next((m for m in merged if near(m, 0.03)), None)
            if hit is None:
                hit = {'n': fix_text(r['n']), 'c': fix_text(r['c']), 'lng': round(r['lng'], 2), 'lat': round(r['lat'], 2),
                       'lat_raw': r['lat'], 'lng_raw': r['lng'], 'p': {}, 'keys': set(), 'alts': set()}
                merged.append(hit)
            else:
                dup_rows += 1
            for y, p in r['p'].items():
                if y in hit['p']:
                    conflicts += hit['p'][y] != p
                else:
                    hit['p'][y] = p
            hit['alts'] |= alts
            if key not in hit['keys']:
                hit['keys'].add(key)
                index.setdefault(key, []).append(hit)
    years = sorted({y for m in merged for y in m['p']})
    cities = []
    for m in sorted(merged, key=lambda m: -max(m['p'].values())):
        cities.append({'n': m['n'], 'c': m['c'], 'lng': m['lng'], 'lat': m['lat'],
                       'p': {str(y): m['p'][y] for y in sorted(m['p'])}})
    out = {'source': 'Reba, Reitsma & Seto (2016), Sci. Data 3:160034 — Chandler (1987) and Modelski (2003) tables, CC BY 4.0',
           'years': years, 'cities': cities}
    path = os.path.join(DATA, 'cities-history.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('cities', len(cities), 'years', len(years), f'({years[0]}..{years[-1]})', 'merged rows', dup_rows,
          'conflicting values (kept first)', conflicts, '%.0f KB' % (os.path.getsize(path) / 1e3))
    by = {c['n']: c for c in cities}
    print('  largest in 2000:', [c['n'] for c in sorted(cities, key=lambda c: -c['p'].get('2000', 0))[:12]])
    print('  largest in 1800:', [c['n'] for c in sorted(cities, key=lambda c: -c['p'].get('1800', 0))[:8]])
    print('  largest in -1000:', [c['n'] for c in sorted(cities, key=lambda c: -c['p'].get('-1000', 0))[:8]])
    for n in ['Babylon', 'Uruk', 'Rome', 'Istanbul', 'Paris', 'Tokyo', 'New York', 'Allentown', 'Montevideo']:
        c = by.get(n)
        if c:
            items = list(c['p'].items())
            print(f'  cities {n:15s} {c["c"]:10s} {c["lat"]},{c["lng"]} {len(items)} values, e.g. {items[:3]} ... {items[-1]}')
        else:
            print(f'  cities {n:15s} MISSING')


if __name__ == '__main__':
    what = sys.argv[1:] or ['lights', 'climate', 'winds', 'cities']
    os.makedirs(DATA, exist_ok=True)
    for name in what:
        globals()['build_' + name]()
