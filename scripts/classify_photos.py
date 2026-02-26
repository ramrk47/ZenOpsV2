#!/usr/bin/env python3
"""
classify_photos.py — Photo category classifier for ZenOps repogen pipeline.

Classification order (cheapest first):
  1. EXIF GPS present → dishank
  2. Evidence sectionKey provided → use it
  3. Filename heuristics (no OCR)
  4. Aspect ratio / resolution heuristics → screenshot candidate
  5. OCR (Tesseract, only on screenshot candidates or unknown)

Usage:
  python3 scripts/classify_photos.py --photos <json_file> --output <out_json_file>

Input JSON: array of objects, each with:
  { "filename": str, "path": str, "contentType": str, "sectionKey": str|null,
    "sortOrder": int, "exifJson": str|null }

Output JSON: same array with added fields:
  { "category": "site"|"guideline"|"map"|"dishank",
    "confidence": 0.0-1.0, "caption": str, "groupSortOrder": int }
"""

import argparse
import json
import os
import re
import struct
import sys
from pathlib import Path

try:
    from PIL import Image
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

try:
    import pytesseract
    HAS_TESSERACT = True
except ImportError:
    HAS_TESSERACT = False


# ─────────────────────── Constants ────────────────────────────────────────────

SECTION_ORDER = ['site', 'guideline', 'map', 'dishank']

SECTION_HEADINGS = {
    'site':      'Site Photographs',
    'guideline': 'Guideline Value Screenshot(s)',
    'map':       'Route Map / Google Maps',
    'dishank':   'GPS / Dishank Location',
}

# Filename keyword map: pattern → category, confidence
FILENAME_PATTERNS = [
    (re.compile(r'dishank|gps|location|lat|lon|coord', re.I), 'dishank', 0.85),
    (re.compile(r'map|route|direction|navig|gmaps|google.?map', re.I), 'map', 0.85),
    (re.compile(r'guideline|kaveri|govt.?rate|registration|sub.?reg|valuat|rate.?table', re.I), 'guideline', 0.85),
    (re.compile(r'site|exterior|front|side|rear|interior|hall|kitchen|bath|roof|terrace|compound', re.I), 'site', 0.80),
]

# SectionKey → category (from evidence.sectionKey in DB)
SECTION_KEY_MAP = {
    'exterior_photos': 'site',
    'interior_photos': 'site',
    'surrounding_photos': 'site',
    'surr_photos': 'site',
    'gps_photos': 'dishank',
    'dishank': 'dishank',
    'guideline_screenshot': 'guideline',
    'map_screenshot': 'map',
    'route_map': 'map',
}

# OCR keyword sets
OCR_KEYWORDS = {
    'guideline': re.compile(
        r'guideline|kaveri|sub.?registrar|valuation|sq\.?m|circle.?rate|ready.?reckoner|jantri', re.I
    ),
    'map': re.compile(
        r'directions?|google\s*maps?|\d+\s*min|\d+\s*km|start\s*location|destination|via\b|fastest.?route', re.I
    ),
    'dishank': re.compile(
        r'dishank|latitude|longitude|accuracy|compass|gps|co.?ordinat|decimal.?degree', re.I
    ),
}

# Phone-like screenshot resolutions (width × height)
PHONE_WIDTHS = {720, 750, 1080, 1125, 1170, 1242, 1440}

SECTION_MARKER_PREFIX = '[[SECTION:'

# ─────────────────────── Helpers ─────────────────────────────────────────────

def has_exif_gps(path: str) -> bool:
    """Fast JPEG EXIF GPS check without full lib. Returns True if GPS IFD found."""
    try:
        with open(path, 'rb') as f:
            data = f.read(65536)
        # Look for GPS marker in EXIF
        return b'GPS' in data or b'\x88\x25' in data  # 0x8825 = GPSInfo tag
    except Exception:
        return False


def get_image_dims(path: str) -> tuple[int, int] | None:
    """Return (width, height) using Pillow if available, else JPEG SOF parsing."""
    if HAS_PILLOW:
        try:
            with Image.open(path) as img:
                return img.size  # (width, height)
        except Exception:
            return None
    # Minimal JPEG dimension parser
    try:
        with open(path, 'rb') as f:
            data = f.read(16384)
        idx = 0
        while idx < len(data) - 9:
            if data[idx] == 0xFF and data[idx + 1] in (0xC0, 0xC2):
                h = struct.unpack('>H', data[idx + 5:idx + 7])[0]
                w = struct.unpack('>H', data[idx + 7:idx + 9])[0]
                return (w, h)
            idx += 1
    except Exception:
        pass
    return None


def is_screenshot_like(path: str) -> bool:
    """Heuristic: tall aspect ratio + phone-like width → likely screenshot."""
    dims = get_image_dims(path)
    if dims is None:
        return False
    w, h = dims
    if w == 0:
        return False
    aspect = h / w
    return aspect > 1.5 and w in PHONE_WIDTHS


def run_ocr(path: str) -> str:
    """Run Tesseract on image, return extracted text."""
    if not HAS_TESSERACT:
        return ''
    try:
        if HAS_PILLOW:
            with Image.open(path) as img:
                return pytesseract.image_to_string(img)
        return pytesseract.image_to_string(path)
    except Exception:
        return ''


def classify_by_ocr(text: str) -> tuple[str, float] | None:
    """Match OCR text against keyword sets. Returns (category, confidence) or None."""
    counts = {}
    for cat, pattern in OCR_KEYWORDS.items():
        matches = pattern.findall(text)
        if matches:
            counts[cat] = len(matches)
    if not counts:
        return None
    best = max(counts, key=lambda c: counts[c])
    # Confidence scales with match count, capped at 0.90.
    conf = min(0.50 + counts[best] * 0.10, 0.90)
    return best, conf


def classify_one(photo: dict) -> dict:
    """Classify a single photo record. Returns updated record."""
    path = photo.get('path', '')
    filename = Path(photo.get('filename', path)).name
    section_key = (photo.get('sectionKey') or '').lower()
    category = None
    confidence = 0.0

    # ── 1. sectionKey from DB (explicit) ──
    if section_key and section_key in SECTION_KEY_MAP:
        category = SECTION_KEY_MAP[section_key]
        confidence = 0.95

    # ── 2. EXIF GPS ──
    if not category and path and os.path.exists(path):
        if has_exif_gps(path):
            category = 'dishank'
            confidence = 0.92

    # ── 3. Filename heuristics ──
    if not category:
        for pattern, cat, conf in FILENAME_PATTERNS:
            if pattern.search(filename):
                category = cat
                confidence = conf
                break

    # ── 4. Screenshot heuristic → OCR ──
    if not category or confidence < 0.60:
        if path and os.path.exists(path) and is_screenshot_like(path):
            ocr_text = run_ocr(path)
            result = classify_by_ocr(ocr_text)
            if result:
                ocr_cat, ocr_conf = result
                if ocr_conf > confidence:
                    category = ocr_cat
                    confidence = ocr_conf

    # ── 5. Default ──
    if not category:
        category = 'site'
        confidence = 0.40

    # Caption
    stem = Path(filename).stem.replace('_', ' ').replace('-', ' ').title()
    caption = photo.get('caption') or stem

    return {
        **photo,
        'category': category,
        'confidence': round(confidence, 2),
        'caption': caption,
        'groupSortOrder': SECTION_ORDER.index(category) * 1000 + photo.get('sortOrder', 0),
    }


# ─────────────────────── Main ─────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='ZenOps photo classifier')
    parser.add_argument('--photos', required=True, help='Input JSON file of photo records')
    parser.add_argument('--output', required=True, help='Output JSON file with category added')
    args = parser.parse_args()

    with open(args.photos) as f:
        photos = json.load(f)

    classified = [classify_one(p) for p in photos]
    # Sort by groupSortOrder (preserves upload order within category)
    classified.sort(key=lambda p: p['groupSortOrder'])

    with open(args.output, 'w') as f:
        json.dump(classified, f, indent=2)

    summary = {}
    for p in classified:
        summary[p['category']] = summary.get(p['category'], 0) + 1
    print(f'Classified {len(classified)} photos: {summary}')


if __name__ == '__main__':
    main()
