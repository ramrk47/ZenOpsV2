#!/usr/bin/env python3
"""
feather_cover.py — Generate a feathered-edge PNG from a cover image.

Applies a Gaussian-blurred alpha mask to soften the image edges — gives a
premium "stamp" look for the cover photo in bank valuation reports.

Usage:
  python3 scripts/feather_cover.py \
    --input <cover.jpg> \
    --output <feathered_cover.png> \
    [--radius 60]
"""

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageFilter, ImageDraw
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False


def feather(input_path: str, output_path: str, radius: int = 60) -> None:
    """Apply feathered edge effect and save as PNG."""
    if not HAS_PILLOW:
        raise RuntimeError("Pillow not installed. Run: pip3 install Pillow")

    with Image.open(input_path) as img:
        img = img.convert('RGBA')
        w, h = img.size

        # Build alpha mask: white center, black edges
        mask = Image.new('L', (w, h), 0)
        draw = ImageDraw.Draw(mask)

        # Draw a solid filled rectangle inset by 'radius' pixels
        draw.rectangle(
            [radius, radius, w - radius, h - radius],
            fill=255
        )

        # Blur the mask to create the feathered gradient
        mask = mask.filter(ImageFilter.GaussianBlur(radius=radius))

        # Apply as alpha channel
        r, g, b, a = img.split()
        new_alpha = Image.composite(mask, Image.new('L', (w, h), 0), mask)
        img.putalpha(new_alpha)

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path, 'PNG')
    print(f'Feathered cover saved → {output_path} ({w}×{h}px, radius={radius})')


def main():
    parser = argparse.ArgumentParser(description='ZenOps cover image feather effect')
    parser.add_argument('--input', required=True, help='Input image (JPG/PNG)')
    parser.add_argument('--output', required=True, help='Output PNG path')
    parser.add_argument('--radius', type=int, default=60, help='Feather radius in pixels')
    args = parser.parse_args()

    if not Path(args.input).exists():
        print(f'ERROR: Input not found: {args.input}', file=sys.stderr)
        sys.exit(1)

    feather(args.input, args.output, args.radius)


if __name__ == '__main__':
    main()
