"""Draws the app icons: the glowing ball of the loading screen (.boot-globe in styles.css).

  python scripts/make-icons.py

- public/icon-192.png, public/icon-512.png, public/favicon.ico: the ball on the dark
  rounded tile (web app, browser tab, older Androids).
- public/icon-fg.png: the ball alone on transparent, sized for the safe zone of an Android
  adaptive icon (scripts/android-setup.mjs puts it on the app's dark background).
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, 'public')

ACCENT = np.array([0x3E, 0xCF, 0xB2], float)
ACCENT_HI = ACCENT * 0.55 + 255 * 0.45  # color-mix(in oklab, accent 55%, white), close enough
BLUE = np.array([0x2A, 0x6F, 0xB0], float)
TILE = np.array([0x0D, 0x13, 0x22], float)


def ball(size, radius, tile=True, ss=4):
    """RGBA image of `size` px with the ball of `radius` (fraction of size) in the middle."""
    n = size * ss
    y, x = np.mgrid[0:n, 0:n].astype(float) + 0.5
    cx = cy = n / 2
    r = radius * n
    dx, dy = (x - cx) / r, (y - cy) / r
    d = np.hypot(dx, dy)

    # 140deg linear gradient across the ball: hi -> accent (45%) -> blue.
    a = np.radians(140)
    t = np.clip(((dx * np.sin(a) - dy * np.cos(a)) + 1) / 2, 0, 1)[..., None]
    col = np.where(t < 0.45, ACCENT_HI + (ACCENT - ACCENT_HI) * (t / 0.45), ACCENT + (BLUE - ACCENT) * ((t - 0.45) / 0.55))
    # Highlight at (35%, 30%) of the ball's box, fading out over 35% of its size.
    hx, hy = (-0.3, -0.4)
    h = np.clip(1 - np.hypot(dx - hx, dy - hy) / 0.7, 0, 1)[..., None]
    col = col + (255 - col) * 0.55 * h
    # Inner shadow toward the bottom right.
    s = np.clip((dx * 0.6 + dy * 0.75 + (d - 0.55)) / 1.2, 0, 1)[..., None]
    col = col * (1 - 0.38 * s)
    inside = np.clip((1 - d) * r / 1.0, 0, 1)  # 1 px anti-aliased edge

    rgb = np.zeros((n, n, 3))
    alpha = np.zeros((n, n))
    if tile:
        # Rounded dark tile.
        m = n * 0.22
        qx = np.maximum(np.abs(x - cx) - (n / 2 - m), 0)
        qy = np.maximum(np.abs(y - cy) - (n / 2 - m), 0)
        tile_a = np.clip((m - np.hypot(qx, qy)) / ss, 0, 1)
        rgb[:] = TILE
        alpha = tile_a
    # Teal glow around the ball.
    glow = np.clip(1 - (d - 1) / 0.55, 0, 1) ** 2 * (d > 0.98)
    g = (glow * 0.55)
    rgb = rgb * (1 - g[..., None]) + ACCENT * g[..., None] if tile else rgb
    alpha = np.maximum(alpha, g if not tile else alpha)
    if not tile:
        rgb[:] = ACCENT
    # The ball over it all.
    rgb = rgb * (1 - inside[..., None]) + col * inside[..., None]
    alpha = np.maximum(alpha, inside)
    img = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
    return Image.fromarray(img, 'RGBA').resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    for size in (192, 512):
        ball(size, 0.3).save(os.path.join(PUBLIC, f'icon-{size}.png'), optimize=True)
    ball(256, 0.34).save(os.path.join(PUBLIC, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (256, 256)])
    # Adaptive icon foreground: 432 px = 108 dp at xxxhdpi; the safe zone is the middle 66 dp.
    ball(432, 0.23, tile=False).save(os.path.join(PUBLIC, 'icon-fg.png'), optimize=True)
    print('icons written')
