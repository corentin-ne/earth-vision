"""Builds the offline raster tiles in public/tiles from the sources in .cache.

  python scripts/build-rasters.py

- relief: Natural Earth I shaded relief (equirectangular GeoTIFF), ocean masked
  out with the map's own regions, reprojected to Web Mercator 512px WebP tiles.
- relief-hi: zoom 5 from the 1:10m edition, for close-up work (not run by default).
- dem: AWS terrarium elevation tiles (zoom 0-6) with the sea floor flattened to 0 m so
  hillshade and 3D terrain only show relief on land, as lossless WebP.
- bathy: the same tiles the other way round — land flattened to 0 m, sea floor kept
  (quantized below the shelf so the PNGs compress well) — coloured as water depth.
"""
import io
import json
import math
import os
import shutil
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.cache')
OUT = os.path.join(ROOT, 'public', 'tiles')
TILE = 512
MAX_Z = 4  # 512px tiles at z4 == 8192px world, matches the 10800px source
# On the globe MapLibre stretches the outermost row of each tile over the polar cap
# (beyond ±85.05°), which shows every pixel of that row as a streak running to the pole.
# Rasters are therefore faded to uniform rows across this latitude band.
# Latitude bands per pole (1 = north, -1 = south): where rows fade to uniform, and where
# their north–south profile flattens. Hillshade fades the south from far out: MapLibre leaves
# visible seams between DEM tiles near the poles, which only vanish where the ice plateau is
# shaded almost flat.
POLAR = {'fade': {1: (80.5, 84.6), -1: (80.5, 84.6)}, 'flat': {1: (83.4, 85.0), -1: (83.4, 85.0)}}
POLAR_HILLSHADE = {'fade': {1: (80.5, 84.6), -1: (74.0, 84.6)}, 'flat': {1: (83.4, 85.0), -1: (79.0, 85.0)}}


def merc_lat(y):
    """Latitude of a Web Mercator y in 0..1 (top = north)."""
    return np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * np.asarray(y, dtype=np.float64)))))


def ramp(lat, bands):
    """Smoothstep across the latitude band of each pole."""
    lat = np.asarray(lat, dtype=np.float64)
    lo = np.where(lat > 0, bands[1][0], bands[-1][0])
    hi = np.where(lat > 0, bands[1][1], bands[-1][1])
    t = np.clip((np.abs(lat) - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def polar_weight(lat, bands=POLAR):
    """0 away from the poles, rising smoothly to 1 at the edge of the mercator square."""
    return ramp(lat, bands['fade'])


def polar_fade(values, lat, bands=POLAR):
    """Blends each row of `values` (rows × cols [× channels], whole world wide) toward its own
    mean: the poleward rows lose their east–west detail but keep the north–south profile,
    so the cap is uniform without inventing a slope that hillshade would draw. Over the last
    stretch that profile is flattened too, as nothing beyond the edge continues the slope."""
    shape = (-1,) + (1,) * (values.ndim - 1)
    means = values.mean(axis=1, keepdims=True)
    flat = ramp(lat, bands['flat']).reshape(shape)
    for sign in (1, -1):
        rows = np.nonzero(np.sign(lat) == sign)[0]
        if len(rows):
            edge = rows[np.argmax(np.abs(lat[rows]))]
            means[rows] = means[rows] * (1 - flat[rows]) + means[edge] * flat[rows]
    w = polar_weight(lat, bands).reshape(shape)
    return values * (1 - w) + means * w


def land_mask(w, h):
    """Rasterize the admin-0 polygons into an equirectangular land mask."""
    with open(os.path.join(CACHE, 'ne', 'ne_50m_admin_0_countries.geojson'), encoding='utf-8') as f:
        fc = json.load(f)
    mask = Image.new('L', (w, h), 0)
    draw = ImageDraw.Draw(mask)

    def px(ring):
        return [((x + 180) / 360 * w, (90 - y) / 180 * h) for x, y in ring]

    for feat in fc['features']:
        g = feat['geometry']
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        for poly in polys:
            draw.polygon(px(poly[0]), fill=255)
            for hole in poly[1:]:
                draw.polygon(px(hole), fill=0)
    # Slightly grown, so the sea floor's land tucks under the vector coast.
    return mask.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.2))


def region_mask(w, h):
    """Equirectangular mask of the regions the map draws (public/data/earth.json), shrunk a
    little with a soft edge: the relief then stays inside the drawn coast instead of leaking
    grey specks onto the sea, and the land base fills the hairline it leaves."""
    with open(os.path.join(ROOT, 'public', 'data', 'earth.json'), encoding='utf-8') as f:
        topo = json.load(f)['topology']
    (sx, sy), (tx, ty) = topo['transform']['scale'], topo['transform']['translate']
    arcs = []
    for arc in topo['arcs']:
        pts = np.cumsum(np.asarray(arc, dtype=np.float64), axis=0)
        arcs.append([((x * sx + tx + 180) / 360 * w, (90 - (y * sy + ty)) / 180 * h) for x, y in pts])

    def ring(idx):
        out = []
        for a in idx:
            pts = arcs[a] if a >= 0 else arcs[~a][::-1]
            out.extend(pts if not out else pts[1:])
        return out

    mask = Image.new('L', (w, h), 0)
    draw = ImageDraw.Draw(mask)
    for g in topo['objects']['regions']['geometries']:
        polys = [g['arcs']] if g['type'] == 'Polygon' else g['arcs'] if g['type'] == 'MultiPolygon' else []
        for poly in polys:
            draw.polygon(ring(poly[0]), fill=255)
            for hole in poly[1:]:
                draw.polygon(ring(hole), fill=0)
    return mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.0))


def build_relief():
    src_path = os.path.join(CACHE, 'relief', 'NE1_50M_SR_W', 'NE1_50M_SR_W.tif')
    src = Image.open(src_path).convert('RGB')
    w, h = src.size
    print('relief source', w, h)
    rgba = src.convert('RGBA')
    rgba.putalpha(region_mask(w, h))
    arr = np.asarray(rgba)

    world = TILE << MAX_Z
    out = np.zeros((world, world, 4), dtype=np.uint8)
    xs = (np.arange(world) + 0.5) / world  # 0..1
    sx = np.clip((xs * w).astype(np.int32), 0, w - 1)
    for row in range(world):
        y = (row + 0.5) / world
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y))))
        sy = min(h - 1, max(0, int((90 - lat) / 180 * h)))
        out[row] = arr[sy, sx]
    # Uniform polar caps, averaged in premultiplied alpha so transparent sea adds no colour.
    lat = merc_lat((np.arange(world) + 0.5) / world)
    for row in np.nonzero(polar_weight(lat) > 0)[0]:
        px = out[row].astype(np.float64)
        a = px[:, 3:] / 255
        pm = np.concatenate([px[:, :3] * a, px[:, 3:]], axis=1)
        pm = polar_fade(pm[None], lat[row:row + 1])[0]
        alpha = np.maximum(pm[:, 3:], 1e-6) / 255
        rgb = np.where(pm[:, 3:] > 0, pm[:, :3] / alpha, 0)
        out[row] = np.clip(np.concatenate([rgb, pm[:, 3:]], axis=1) + 0.5, 0, 255).astype(np.uint8)
    big = Image.fromarray(out, 'RGBA')
    del out

    dest = os.path.join(OUT, 'relief')
    for z in range(MAX_Z + 1):
        shutil.rmtree(os.path.join(dest, str(z)), ignore_errors=True)
    count = 0
    for z in range(MAX_Z, -1, -1):
        size = TILE << z
        img = big if size == world else big.resize((size, size), Image.LANCZOS)
        n = 1 << z
        for x in range(n):
            for y in range(n):
                tile = img.crop((x * TILE, y * TILE, (x + 1) * TILE, (y + 1) * TILE))
                if tile.getchannel('A').getextrema()[1] == 0:
                    tile = Image.new('RGBA', (16, 16), (0, 0, 0, 0))  # open ocean: tiny transparent tile, no 404s
                d = os.path.join(dest, str(z), str(x))
                os.makedirs(d, exist_ok=True)
                tile.save(os.path.join(d, f'{y}.webp'), 'WEBP', quality=80, method=6)
                count += 1
    print('relief tiles', count)


HI_Z = 5  # 512px tiles at z5 == 16384px world, matches the 21600px 1:10m source


def build_relief_hi():
    """Zoom 5 relief from Natural Earth I at 1:10m, for close-up work. Built one row of tiles
    at a time (the whole z5 world would not fit in memory); polar rows are
    faded like the lower zooms."""
    src_path = os.path.join(CACHE, 'relief', 'NE1_HR_LC_SR_W', 'NE1_HR_LC_SR_W.tif')
    src = Image.open(src_path).convert('RGB')
    w, h = src.size
    print('relief (1:10m) source', w, h, flush=True)
    rgba = src.convert('RGBA')
    del src
    rgba.putalpha(region_mask(w, h))
    arr = np.asarray(rgba)
    del rgba
    dest = os.path.join(OUT, 'relief', str(HI_Z))
    shutil.rmtree(dest, ignore_errors=True)
    n = 1 << HI_Z
    world = TILE * n
    xs = (np.arange(world) + 0.5) / world
    sx = np.clip((xs * w).astype(np.int32), 0, w - 1)
    count = 0
    for ty in range(n):
        rows = (ty * TILE + np.arange(TILE) + 0.5) / world
        lat = merc_lat(rows)
        sy = np.clip(((90 - lat) / 180 * h).astype(np.int32), 0, h - 1)
        strip = arr[sy][:, sx]
        if polar_weight(lat).max() > 0:
            # Uniform polar caps, as in build_relief (premultiplied, whole rows).
            px = strip.astype(np.float64)
            a = px[..., 3:] / 255
            pm = polar_fade(np.concatenate([px[..., :3] * a, px[..., 3:]], axis=2), lat)
            alpha = np.maximum(pm[..., 3:], 1e-6) / 255
            rgb = np.where(pm[..., 3:] > 0, pm[..., :3] / alpha, 0)
            strip = np.clip(np.concatenate([rgb, pm[..., 3:]], axis=2) + 0.5, 0, 255).astype(np.uint8)
        for tx in range(n):
            tile = Image.fromarray(strip[:, tx * TILE:(tx + 1) * TILE], 'RGBA')
            if tile.getchannel('A').getextrema()[1] == 0:
                tile = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
            d = os.path.join(dest, str(tx))
            os.makedirs(d, exist_ok=True)
            tile.save(os.path.join(d, f'{ty}.webp'), 'WEBP', quality=78, method=6)
            count += 1
    print('relief z5 tiles', count)


def read_elev(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768


def tile_lats(z, ty, size):
    return merc_lat((ty * size + np.arange(size) + 0.5) / ((1 << z) * size))


def elevation_tiles(src, zooms, transform, bands=POLAR):
    """Yields (z, x, name, elevation) for every source tile after `transform`, with the
    polar rows faded: tile rows reaching into a fade band are stitched round the world
    first, since the fade needs whole rows."""
    for z in zooms:
        n = 1 << z
        cols = sorted(os.listdir(os.path.join(src, str(z))), key=int)
        size = Image.open(os.path.join(src, str(z), cols[0], '0.png')).size[1]
        edge_rows = {y for y in range(n) if polar_weight(tile_lats(z, y, size), bands).max() > 0}
        for y in sorted(edge_rows):
            name = f'{y}.png'
            tiles = [transform(read_elev(os.path.join(src, str(z), x, name)), z, int(x), y) for x in cols]
            row = polar_fade(np.concatenate(tiles, axis=1), tile_lats(z, y, size), bands)
            for x, tile in zip(cols, np.split(row, len(cols), axis=1)):
                yield z, x, name, tile
        for x in cols:
            for name in os.listdir(os.path.join(src, str(z), x)):
                y = int(name.split('.')[0])
                if y not in edge_rows:
                    yield z, x, name, transform(read_elev(os.path.join(src, str(z), x, name)), z, int(x), y)


def terrarium(elev):
    v = elev + 32768
    r = (v // 256).astype(np.uint8)
    g = (np.floor(v) % 256).astype(np.uint8)
    b = ((v - np.floor(v)) * 256).astype(np.uint8)
    return np.dstack([r, g, b])


# Height step (metres) per zoom; zooms not listed keep the full precision.
DEM_STEP = {5: 2, 6: 4}
DEM_FINE_BELOW = 120


def save_dem(rgb, path):
    """Elevation tiles are lossless WebP (about half the size of PNG) or PNG, by extension."""
    img = Image.fromarray(rgb, 'RGB')
    if path.endswith('.webp'):
        img.save(path, 'WEBP', lossless=True, method=6, exact=True)
    else:
        img.save(path, optimize=True)


def build_dem():
    src = os.path.join(CACHE, 'dem')
    dest = os.path.join(OUT, 'dem')
    shutil.rmtree(dest, ignore_errors=True)
    count = 0
    flatten_sea = lambda elev, z, x, y: np.clip(elev, 0, None)
    zooms = sorted(int(z) for z in os.listdir(src))
    for z, x, name, elev in elevation_tiles(src, zooms, flatten_sea, POLAR_HILLSHADE):
        d = os.path.join(dest, str(z), x)
        os.makedirs(d, exist_ok=True)
        step = DEM_STEP.get(z)
        if step:
            # The close-up zooms are most of the weight: coarser height steps (no fraction
            # byte) compress far better, and a few metres are nothing next to the relief
            # these zooms are there to show.
            # Whole metres on low ground: the height colours tell 5 m from 10 m there.
            rgb = terrarium(np.where(elev < DEM_FINE_BELOW, np.round(elev), np.round(elev / step) * step))
            rgb[..., 2] = 0
        else:
            rgb = terrarium(elev)
        save_dem(rgb, os.path.join(d, name.replace('.png', '.webp')))
        count += 1
    seal_antimeridian(dest)
    print('dem tiles', count)


def seal_antimeridian(dest, k=4):
    """MapLibre never shares DEM border pixels across the antimeridian (its neighbour lookup
    ignores the world wrap), so hillshade draws a line there. Both sides are eased onto
    the same value with no slope across the seam, which leaves nothing to shade."""
    for z in os.listdir(dest):
        n = 1 << int(z)
        for name in os.listdir(os.path.join(dest, z, '0')):
            lp, rp = os.path.join(dest, z, '0', name), os.path.join(dest, z, str(n - 1), name)
            if not os.path.exists(rp):
                continue
            left = read_elev(lp)
            right = left if rp == lp else read_elev(rp)  # z0: one tile is both sides
            seam = (left[:, :1] + right[:, -1:]) / 2
            t = np.arange(k) / k
            w = (1 - t * t * (3 - 2 * t))[None, :]  # 1 at the seam, easing to 0 inland
            left[:, :k] = left[:, :k] * (1 - w) + seam * w
            right[:, -k:] = right[:, -k:] * (1 - w[:, ::-1]) + seam * w[:, ::-1]
            save_dem(terrarium(left), lp)
            if rp != lp:
                save_dem(terrarium(right), rp)


def build_bathy():
    src = os.path.join(CACHE, 'dem')
    dest = os.path.join(OUT, 'bathy')
    shutil.rmtree(dest, ignore_errors=True)
    count = 0
    # Land as the map draws it: islets the elevation data knows but the map lacks become
    # shallow water, past the animated surf zone, so no surf ring floats around nothing.
    mw, mh = 8192, 4096
    mask = np.asarray(land_mask(mw, mh)) > 96

    def sea_floor(elev, z, x, ty):
        size = elev.shape[0]
        n = 1 << z
        gx = (x * size + np.arange(size) + 0.5) / (n * size)
        lng = gx * 360 - 180
        lat = tile_lats(z, ty, size)
        mx = np.clip(((lng + 180) / 360 * mw).astype(np.int32), 0, mw - 1)
        my = np.clip(((90 - lat) / 180 * mh).astype(np.int32), 0, mh - 1)
        on_land = mask[my[:, None], mx[None, :]]
        elev = np.where(on_land, np.minimum(elev, 0), np.where(elev >= -1, -25, elev))
        return np.clip(elev, None, 0)

    # Up to z3 only (~2 MB): the sea floor is smooth, so overzooming it further loses little.
    zooms = sorted(int(z) for z in os.listdir(src) if int(z) <= 3)
    for z, x, name, elev in elevation_tiles(src, zooms, sea_floor):
        # 2 m steps on the shelf (where the surf animates), 100 m steps in the deep.
        elev = np.where(elev > -250, np.round(elev / 2) * 2, np.round(elev / 100) * 100)
        rgb = terrarium(elev)
        rgb[..., 2] = 0
        d = os.path.join(dest, str(z), x)
        os.makedirs(d, exist_ok=True)
        Image.fromarray(rgb, 'RGB').save(os.path.join(d, name), optimize=True)
        count += 1
    seal_antimeridian(dest)
    print('bathy tiles', count)


if __name__ == '__main__':
    what = sys.argv[1:] or ['relief', 'dem', 'bathy']
    if 'bathy' in what:
        build_bathy()
    if 'relief' in what:
        build_relief()
    if 'relief-hi' in what:
        build_relief_hi()
    if 'dem' in what:
        build_dem()
