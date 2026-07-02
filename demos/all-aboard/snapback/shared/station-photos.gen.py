"""Generate station-photos.gen.mjs — full-screen poster-stylized Caltrain station art.

Regenerate: python3 demos/all-aboard/snapback/shared/station-photos.gen.py
  (needs Pillow + network access to Wikimedia Commons on the first run;
   originals + attribution are cached in ~/.cache/snapback-station-photos/)

Each station's Wikimedia Commons photo (from the Wikipedia "List of Caltrain
stations" table) is cover-cropped to a 640x1136 portrait canvas and run through a
deterministic "travel poster" stylization: median-smoothed, saturation-lifted,
median-cut quantized to 18 colors, then overlaid with a soft dark ink line pulled
from the luminance edges. The flattened look is what lets the board type sit
directly on the artwork (LLP 0027#station-identity) — the legibility scrims
themselves are baked by model.mjs into the SVG wrapper, not into the JPEG, so the
design can tune them without refetching.

The stylization is algorithmic (Pillow), not an image-generation model: the same
input bytes always produce the same artwork, which keeps the committed asset
deterministic and the pipeline runnable offline once the originals are cached.
"""

import base64
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

W, H = 640, 1136
JPEG_QUALITY = 64
FETCH_WIDTH = 1400

API = "https://en.wikipedia.org/w/api.php"
UA = "SnapbackAllAboardDemo/1.0 (ccheever@gmail.com)"
CACHE = Path.home() / ".cache" / "snapback-station-photos"

# stationId -> (Wikimedia Commons file, vertical crop bias 0=top 1=bottom)
MAP = [
    ("san-francisco",    "4th and King station from I-280 ramp (3), December 2019.JPG", 0.42),
    ("twenty-second-st", "22nd Street station facing south, November 2017.jpg", 0.42),
    ("bayshore",         "Bayshore Station 3226 14.JPG", 0.42),
    ("south-sf",         "South San Francisco Caltrain station from Grand Avenue overpass.jpg", 0.42),
    ("san-bruno",        "San Bruno Caltrain station platform, June 2018.JPG", 0.42),
    ("millbrae",         "Millbrae station from Millbrae Avenue, July 2018.JPG", 0.42),
    ("burlingame",       "Burlingame station building from northbound platform, August 2018.JPG", 0.42),
    ("san-mateo",        "San Mateo station from garage (2), August 2018.JPG", 0.42),
    ("hayward-park",     "Hayward Park Caltrain.jpg", 0.42),
    ("hillsdale",        "Southbound train leaving Hillsdale station, May 2021.jpg", 0.42),
    ("belmont",          "Two trains at Belmont station, December 2020.jpg", 0.42),
    ("san-carlos",       "Northbound train at San Carlos station, November 2018.JPG", 0.42),
    ("redwood-city",     "Northbound train leaving Redwood City station, November 2018.JPG", 0.42),
    ("menlo-park",       "Menlo Park station building, January 2010.jpeg", 0.42),
    ("palo-alto",        "Palo Alto station building, January 2010.jpg", 0.42),
    ("california-ave",   "California Avenue train station, California, USA 2007.jpg", 0.42),
    ("mountain-view",    "Train Station, Mountain View, California, U.S.A., 2010 - panoramio.jpg", 0.42),
    ("sunnyvale",        "Northbound train at Sunnyvale station, November 2018.JPG", 0.42),
    ("lawrence",         "Lawrence-station.png", 0.42),
    ("santa-clara",      "Santa Clara Depot. California railway station 1863.JPG", 0.42),
    ("san-jose",         "San Jose Diridon station, November 2019.JPG", 0.42),
]


def fetch_bytes(url):
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            return urllib.request.urlopen(req, timeout=30).read()
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            raise
    raise RuntimeError("gave up: " + url)


def clean_html(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def fetch_original(sid, fname):
    """Original thumb + attribution, cached so re-styling never refetches."""
    img_path = CACHE / f"{sid}.img"
    meta_path = CACHE / f"{sid}.json"
    if img_path.exists() and meta_path.exists():
        return img_path.read_bytes(), json.loads(meta_path.read_text())
    d = json.loads(
        fetch_bytes(
            API
            + "?"
            + urllib.parse.urlencode(
                {
                    "action": "query",
                    "format": "json",
                    "prop": "imageinfo",
                    "titles": "File:" + fname,
                    "iiprop": "url|extmetadata",
                    "iiurlwidth": FETCH_WIDTH,
                }
            )
        )
    )
    page = next(iter(d["query"]["pages"].values()))
    ii = page["imageinfo"][0]
    meta_all = ii.get("extmetadata", {})
    raw = fetch_bytes(ii["thumburl"])
    meta = {
        "artist": clean_html(meta_all.get("Artist", {}).get("value", "")),
        "license": clean_html(meta_all.get("LicenseShortName", {}).get("value", "")),
    }
    CACHE.mkdir(parents=True, exist_ok=True)
    img_path.write_bytes(raw)
    meta_path.write_text(json.dumps(meta))
    time.sleep(2)  # Wikimedia rate-limits unthrottled loops (HTTP 429)
    return raw, meta


def cover_crop(img, bias):
    scale = max(W / img.width, H / img.height)
    nw, nh = round(img.width * scale), round(img.height * scale)
    img = img.resize((nw, nh), Image.LANCZOS)
    left = (nw - W) // 2
    top = round((nh - H) * bias)
    return img.crop((left, top, left + W, top + H))


def ink_edges(img, strength=0.28, blur=0.9):
    gray = img.convert("L").filter(ImageFilter.GaussianBlur(0.8))
    edges = ImageOps.autocontrast(gray.filter(ImageFilter.FIND_EDGES))
    alpha = edges.filter(ImageFilter.GaussianBlur(blur)).point(
        lambda v: min(255, int(v * strength * 2.2))
    )
    out = img.copy()
    out.paste(Image.new("RGB", img.size, (18, 16, 24)), (0, 0), alpha)
    return out


def posterize(img):
    ww, hh = round(W * 0.66), round(H * 0.66)
    small = img.resize((ww, hh), Image.LANCZOS)
    smooth = small.filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.MedianFilter(3))
    sat = ImageEnhance.Color(smooth).enhance(1.24)
    sat = ImageEnhance.Contrast(sat).enhance(1.06)
    quant = sat.quantize(colors=18, method=Image.Quantize.MEDIANCUT).convert("RGB")
    return ink_edges(quant.resize((W, H), Image.LANCZOS))


out = {}
review = []
for sid, fname, bias in MAP:
    raw, meta = fetch_original(sid, fname)
    src = Image.open(io.BytesIO(raw)).convert("RGB")
    art = posterize(cover_crop(src, bias))
    buf = io.BytesIO()
    art.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    b = buf.getvalue()
    attribution = ", ".join(p for p in [meta["artist"], meta["license"]] if p) or "Wikimedia Commons"
    out[sid] = {
        "artUri": "data:image/jpeg;base64," + base64.b64encode(b).decode(),
        "attribution": attribution,
        "sourceFile": fname,
        "bytes": len(b),
    }
    review.append(art)
    print(f"{sid:18} {len(b)//1024:4}K  {attribution[:60]}", file=sys.stderr)

total = sum(v["bytes"] for v in out.values())
print(f"TOTAL {total//1024}K JPEG across {len(out)} stations", file=sys.stderr)

# Review contact sheet (cache dir only, never committed) for crop/treatment QA.
tw, th = 200, 355
cols = 7
rows = (len(review) + cols - 1) // cols
sheet = Image.new("RGB", (tw * cols, th * rows), (16, 16, 20))
for i, art in enumerate(review):
    sheet.paste(art.resize((tw, th), Image.LANCZOS), ((i % cols) * tw, (i // cols) * th))
sheet_path = CACHE / "review-sheet.jpg"
sheet.save(sheet_path, quality=82)
print(f"review sheet: {sheet_path}", file=sys.stderr)

HEADER = '''// @generated by snapback/shared/station-photos.gen.py — do NOT edit by hand.
//   Regenerate: python3 demos/all-aboard/snapback/shared/station-photos.gen.py
//   (needs Pillow; network to Wikimedia Commons on first run, then cached)
//
// Full-screen (640x1136) poster-stylized Caltrain station art, derived from the
// real Wikimedia Commons station photos and inlined as base64 JPEG so the surface
// renders with ZERO egress and full determinism. The stylization is algorithmic
// (smooth -> saturate -> 18-color median-cut quantize -> ink edge overlay), chosen
// so board type stays legible directly over the artwork; the legibility scrims
// live in the SVG wrapper built by model.mjs stationPhoto(), not in these bytes.
// See LLP 0027#station-identity.
//
// attribution: "<author>, <license>" — CC BY / CC BY-SA / CC0, Wikimedia Commons.
// The derived artwork is a transformation of each photo and keeps its license.

export const STATION_PHOTOS = {
'''


def esc(s):
    return s.replace("\\", "\\\\").replace("'", "\\'")


parts = [HEADER]
for sid, _fname, _bias in MAP:
    v = out[sid]
    parts.append("  '%s': {\n" % sid)
    parts.append("    attribution: '%s',\n" % esc(v["attribution"]))
    parts.append("    sourceFile: '%s',\n" % esc(v["sourceFile"]))
    parts.append("    artUri: '%s',\n" % esc(v["artUri"]))
    parts.append("  },\n")
parts.append("};\n")

dest = Path(__file__).parent / "station-photos.gen.mjs"
dest.write_text("".join(parts))
print(f"wrote {dest}", file=sys.stderr)
