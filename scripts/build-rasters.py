"""Builds the offline raster tiles in public/tiles from the sources in .cache.

  python scripts/build-rasters.py

- relief: Natural Earth I shaded relief (equirectangular GeoTIFF), ocean masked
  out with the admin-0 land polygons, reprojected to Web Mercator 512px WebP tiles.
- dem: AWS terrarium elevation tiles with the sea floor flattened to 0 m so
  hillshade and 3D terrain only show relief on land.
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
    # Soft, slightly grown coastline so the relief tucks under the vector coast.
    return mask.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.2))


def build_relief():
    src_path = os.path.join(CACHE, 'relief', 'NE1_50M_SR_W', 'NE1_50M_SR_W.tif')
    src = Image.open(src_path).convert('RGB')
    w, h = src.size
    print('relief source', w, h)
    rgba = src.convert('RGBA')
    rgba.putalpha(land_mask(w, h))
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
    big = Image.fromarray(out, 'RGBA')
    del out

    dest = os.path.join(OUT, 'relief')
    shutil.rmtree(dest, ignore_errors=True)
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


def build_dem():
    src = os.path.join(CACHE, 'dem')
    dest = os.path.join(OUT, 'dem')
    shutil.rmtree(dest, ignore_errors=True)
    count = 0
    for z in sorted(os.listdir(src), key=int):
        for x in os.listdir(os.path.join(src, z)):
            for name in os.listdir(os.path.join(src, z, x)):
                a = np.asarray(Image.open(os.path.join(src, z, x, name)).convert('RGB')).astype(np.int32)
                elev = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
                elev = np.clip(elev, 0, None)
                v = elev + 32768
                r = (v // 256).astype(np.uint8)
                g = (np.floor(v) % 256).astype(np.uint8)
                b = ((v - np.floor(v)) * 256).astype(np.uint8)
                d = os.path.join(dest, z, x)
                os.makedirs(d, exist_ok=True)
                Image.fromarray(np.dstack([r, g, b]), 'RGB').save(os.path.join(d, name), optimize=True)
                count += 1
    print('dem tiles', count)


def build_bathy():
    src = os.path.join(CACHE, 'dem')
    dest = os.path.join(OUT, 'bathy')
    shutil.rmtree(dest, ignore_errors=True)
    count = 0
    # Land as the map draws it: islets the elevation data knows but the map lacks become
    # shallow water, past the animated surf zone, so no surf ring floats around nothing.
    mw, mh = 8192, 4096
    mask = np.asarray(land_mask(mw, mh)) > 96
    # Up to z3 only (~2 MB): the sea floor is smooth, so overzooming it further loses little.
    for z in [z for z in sorted(os.listdir(src), key=int) if int(z) <= 3]:
        for x in os.listdir(os.path.join(src, z)):
            for name in os.listdir(os.path.join(src, z, x)):
                a = np.asarray(Image.open(os.path.join(src, z, x, name)).convert('RGB')).astype(np.float64)
                elev = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
                size = elev.shape[0]
                n = 1 << int(z)
                ty = int(name.split('.')[0])
                gx = (int(x) * size + np.arange(size) + 0.5) / (n * size)
                gy = (ty * size + np.arange(size) + 0.5) / (n * size)
                lng = gx * 360 - 180
                lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * gy))))
                mx = np.clip(((lng + 180) / 360 * mw).astype(np.int32), 0, mw - 1)
                my = np.clip(((90 - lat) / 180 * mh).astype(np.int32), 0, mh - 1)
                on_land = mask[my[:, None], mx[None, :]]
                elev = np.where(on_land, np.minimum(elev, 0), np.where(elev >= -1, -25, elev))
                elev = np.clip(elev, None, 0)
                # 2 m steps on the shelf (where the surf animates), 100 m steps in the deep.
                elev = np.where(elev > -250, np.round(elev / 2) * 2, np.round(elev / 100) * 100)
                v = elev + 32768
                r = (v // 256).astype(np.uint8)
                g = (np.floor(v) % 256).astype(np.uint8)
                b = np.zeros_like(r)
                d = os.path.join(dest, z, x)
                os.makedirs(d, exist_ok=True)
                Image.fromarray(np.dstack([r, g, b]), 'RGB').save(os.path.join(d, name), optimize=True)
                count += 1
    print('bathy tiles', count)


if __name__ == '__main__':
    what = sys.argv[1:] or ['relief', 'dem', 'bathy']
    if 'bathy' in what:
        build_bathy()
    if 'relief' in what:
        build_relief()
    if 'dem' in what:
        build_dem()
