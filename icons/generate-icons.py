# generate-icons.py — Generate missing PNG icon files for the OmniExporter AI extension
#
# Usage:
#   pip install Pillow
#   python icons/generate-icons.py
#
# Output: icons/icon16.png, icons/icon32.png, icons/icon48.png
# (icon128.png is assumed to already exist and is not overwritten)

import os
from PIL import Image, ImageDraw, ImageFont

SIZES = [16, 32, 48]
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))

# Gradient colours: #4F46E5 (indigo) → #06B6D4 (cyan)
COLOR_START = (79, 70, 229)
COLOR_END   = (6, 182, 212)
COLOR_WHITE = (255, 255, 255)


def lerp_color(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))


def make_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded-rectangle gradient background
    radius = max(2, size // 6)
    for y in range(size):
        t = y / max(size - 1, 1)
        color = lerp_color(COLOR_START, COLOR_END, t)
        draw.rectangle([(0, y), (size - 1, y)], fill=color + (255,))

    # Mask to rounded rectangle
    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=radius, fill=255)
    img.putalpha(mask)

    # Draw a simple export-arrow: right-pointing arrow centred in the icon
    draw = ImageDraw.Draw(img)
    m = max(1, size // 8)          # margin
    cx, cy = size // 2, size // 2  # centre
    aw = size - 2 * m              # arrow width
    ah = size - 2 * m              # arrow height
    shaft_h = max(1, ah // 4)
    head_h  = max(2, ah // 2)
    head_w  = max(2, aw // 3)
    shaft_w = aw - head_w

    # Shaft
    sx = m
    sy = cy - shaft_h // 2
    draw.rectangle([(sx, sy), (sx + shaft_w, sy + shaft_h)], fill=COLOR_WHITE + (255,))

    # Arrowhead
    hx = sx + shaft_w
    points = [
        (hx, cy - head_h // 2),
        (hx + head_w, cy),
        (hx, cy + head_h // 2),
    ]
    draw.polygon(points, fill=COLOR_WHITE + (255,))

    return img


def main():
    for size in SIZES:
        out_path = os.path.join(OUTPUT_DIR, f"icon{size}.png")
        icon = make_icon(size)
        icon.save(out_path, "PNG")
        print(f"  Created {out_path} ({size}×{size})")
    print("Done.")


if __name__ == "__main__":
    main()
