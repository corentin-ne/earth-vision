"""Builds public/tiles/flood: for every spot on land, the sea level at which the sea reaches it.

  python scripts/build-sealevel.py      (needs numpy, Pillow, scipy, scikit-image)

A spot floods when the sea rises above its own height *and* above the lowest pass between it
and the ocean — so the Dead Sea, the Caspian shores or Death Valley stay dry until the sea
spills over the hills around them, while the Dutch polders go under at once. That "spill
height" is a depression fill of the elevation (morphological reconstruction by erosion,
seeded with the open ocean), computed once on the zoom-5 grid of the raw elevation tiles.

Tiles are terrarium-encoded like the DEM: 0.5 m steps, clamped at 150 m (no slider goes
higher), the sea itself at -100 m. Lower zooms keep the lowest spill height of the four
children, so a flooded coast never disappears when zooming out.
"""
import importlib.util
import os
import shutil

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage.morphology import reconstruction

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('rasters', os.path.join(HERE, 'build-rasters.py'))
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)

Z = 5
TOP = 150.0
SEA = -100.0


def mosaic(z):
    n = 1 << z
    src = os.path.join(R.CACHE, 'dem', str(z))
    size = Image.open(os.path.join(src, '0', '0.png')).size[1]
    out = np.zeros((n * size, n * size), np.float32)
    for x in range(n):
        for y in range(n):
            p = os.path.join(src, str(x), f'{y}.png')
            if os.path.exists(p):
                out[y * size:(y + 1) * size, x * size:(x + 1) * size] = R.read_elev(p)
    return out, size


def ocean_mask(h, w):
    """The open ocean on the mercator grid: not land on the map, and connected to the big seas
    (so the Caspian, which is no country's either, counts as land at its own surface height)."""
    mw, mh = 8192, 4096
    land = np.asarray(R.land_mask(mw, mh)) > 96
    gx = (np.arange(w) + 0.5) / w
    lng = gx * 360 - 180
    lat = R.merc_lat((np.arange(h) + 0.5) / h)
    mx = np.clip(((lng + 180) / 360 * mw).astype(np.int32), 0, mw - 1)
    my = np.clip(((90 - lat) / 180 * mh).astype(np.int32), 0, mh - 1)
    sea = ~land[my[:, None], mx[None, :]]
    labels, count = ndimage.label(sea)
    sizes = ndimage.sum(sea, labels, range(1, count + 1))
    # The world ocean is one huge component (plus the seas a mercator grid cuts off near the
    # edges); anything under 2% of the largest is an inland water body.
    keep = np.nonzero(sizes >= sizes.max() * 0.02)[0] + 1
    return np.isin(labels, keep)


def main():
    elev, size = mosaic(Z)
    h, w = elev.shape
    ocean = ocean_mask(h, w)
    print('grid', w, h, 'ocean share', round(float(ocean.mean()), 3))
    mask = np.where(ocean, SEA, elev).astype(np.float32)
    # Fill from the ocean: seed is the ocean itself, everything else starts at the top.
    seed = np.where(ocean, SEA, mask.max()).astype(np.float32)
    # Wrap around the antimeridian: pad both sides with the other edge before filling.
    pad = 64
    seed_p = np.concatenate([seed[:, -pad:], seed, seed[:, :pad]], axis=1)
    mask_p = np.concatenate([mask[:, -pad:], mask, mask[:, :pad]], axis=1)
    filled = reconstruction(seed_p, mask_p, method='erosion')[:, pad:-pad]
    del seed_p, mask_p, seed
    spill = np.where(ocean, SEA, np.clip(np.maximum(filled, 0), 0, TOP))
    spill = np.round(spill * 2) / 2

    dest = os.path.join(R.OUT, 'flood')
    shutil.rmtree(dest, ignore_errors=True)
    grid = spill
    count = 0
    for z in range(Z, -1, -1):
        n = 1 << z
        tile = grid.shape[0] // n
        for x in range(n):
            d = os.path.join(dest, str(z), str(x))
            os.makedirs(d, exist_ok=True)
            for y in range(n):
                t = grid[y * tile:(y + 1) * tile, x * tile:(x + 1) * tile]
                if t.shape[0] != 256:
                    t = np.asarray(Image.fromarray(t.astype(np.float32), 'F').resize((256, 256), Image.NEAREST))
                rgb = R.terrarium(t.astype(np.float64))
                R.save_dem(rgb, os.path.join(d, f'{y}.webp'))
                count += 1
        if z:
            # Next zoom out: the lowest spill height of the four children; sea only where all four are sea.
            g = grid.reshape(grid.shape[0] // 2, 2, grid.shape[1] // 2, 2)
            land = np.where(g > SEA, g, np.inf).min(axis=(1, 3))
            grid = np.where(np.isfinite(land), land, SEA).astype(np.float32)
    print('flood tiles', count)


if __name__ == '__main__':
    main()
