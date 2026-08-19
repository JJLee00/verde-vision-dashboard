<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Plant catalog is generated from the Vision Pro app

`src/lib/catalog.json` and `public/plants/*.webp` are BUILD OUTPUTS, not
hand-edited files. The app repo's `PlantItem.sampleCatalog`
(`~/Verde-Vision/Test/Test/Models/PlantItem.swift`) is the source of truth
for which plants exist, their sizes, prices, and field-guide copy.

When a plant is added to the app, regenerate both:

    npm run sync:catalog

That runs `scripts/gen-catalog.mjs` (parses the Swift catalog into
catalog.json) and `scripts/sync-thumbs.py` (copies the app's thumbnail
renders into public/plants as 512px WebP). Commit the results. The Prices
grid and the Plant Library both read catalog.json, so skipping this leaves
a new plant invisible in the dashboard.

Note: the parser deliberately skips `PlantItem(` chunks whose `name:` is an
expression rather than a string literal — those are the hardscape surface
factories (turf, paver styles), which bill per sq ft and are not catalog rows.
