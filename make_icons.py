"""Draws the home-screen icons (site/icon-180.png, icon-192.png, icon-512.png) and the iPhone
app icon (ios/.../AppIcon.appiconset/icon-1024.png) with no extra libraries: the same checkmark as the favicon, white on the accent blue, full-bleed
so iOS and Android can round or mask the corners themselves.

    python make_icons.py
"""
import math
import os
import struct
import zlib

BG = (0x3B, 0x5B, 0xDB)
FG = (255, 255, 255)
# The favicon's checkmark, in a 32x32 box.
POINTS = [(9.5, 16.5), (14, 21), (22.5, 11.5)]
STROKE = 3


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def draw(size):
    scale = size / 32
    half = STROKE / 2
    rows = []
    for y in range(size):
        row = bytearray([0])  # PNG filter: none
        for x in range(size):
            # Sample at the pixel centre in favicon units; distance gives a soft 1px edge.
            px, py = (x + 0.5) / scale, (y + 0.5) / scale
            d = min(seg_dist(px, py, *POINTS[i], *POINTS[i + 1]) for i in range(len(POINTS) - 1))
            a = max(0.0, min(1.0, (half - d) * scale + 0.5))
            row += bytes(round(b + (f - b) * a) for b, f in zip(BG, FG))
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    targets = [(os.path.join(here, "site"), s) for s in (180, 192, 512)]
    targets.append((os.path.join(here, "ios", "Coursework", "Assets.xcassets", "AppIcon.appiconset"), 1024))
    for folder, size in targets:
        with open(os.path.join(folder, f"icon-{size}.png"), "wb") as f:
            f.write(draw(size))
        print(os.path.relpath(os.path.join(folder, f"icon-{size}.png"), here))
