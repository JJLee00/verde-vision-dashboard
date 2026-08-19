#!/usr/bin/env python3
"""Copies the app's plant thumbnail renders into public/plants/ as 512px WebP.

Reads src/lib/catalog.json (run gen-catalog.mjs first) and pulls each
plant's thumbnail PNG out of the app repo's asset catalog. Rerun alongside
gen-catalog.mjs whenever a plant is added.

  python3 scripts/sync-thumbs.py [path/to/Assets.xcassets]
"""
import json, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
XCASSETS = Path(sys.argv[1]) if len(sys.argv) > 1 else (
    Path.home() / "Verde-Vision/Test/Test/Assets.xcassets")
OUT = ROOT / "public/plants"
OUT.mkdir(parents=True, exist_ok=True)

catalog = json.loads((ROOT / "src/lib/catalog.json").read_text())
missing, written = [], 0
for plant in catalog["plants"]:
    thumb = plant.get("thumbnail")
    if not thumb:
        continue
    imageset = XCASSETS / f"{thumb}.imageset"
    pngs = sorted(imageset.glob("*.png"), key=lambda p: p.stat().st_size, reverse=True)
    if not pngs:
        missing.append(plant["name"])
        continue
    im = Image.open(pngs[0])
    im.thumbnail((512, 512), Image.LANCZOS)
    im.save(OUT / f"{thumb}.webp", "WEBP", quality=82)
    written += 1

print(f"wrote {written} thumbs to {OUT}")
if missing:
    sys.exit(f"MISSING imagesets for: {', '.join(missing)}")
