// The stand-in forms a placeholder plant can wear.
//
// Every id here is also a GlyphKind in src/lib/viewer/catalog.ts, so a
// placeholder draws in the living-blueprint viewer with no special-casing,
// and the headset picks the matching low-poly massing model.
//
// The drawings are deliberately schematic — a massing study, not a failed
// attempt at a photo. A client reads "stand-in" instantly and trusts the
// size, which is the whole job: what the plant fills, blocks, and frames.

export type PlaceholderSymbol =
  | "tree"
  | "palm"
  | "shrub"
  | "groundcover"
  | "saguaro"
  | "columnar"
  | "rosette"
  | "barrel";

export const SYMBOLS: {
  id: PlaceholderSymbol;
  label: string;
  hint: string;
  // Typical mature footprint, used to prefill the size fields.
  defaultHeightFt: number;
  defaultWidthFt: number;
}[] = [
  { id: "tree", label: "Tree", hint: "Canopy on a trunk", defaultHeightFt: 20, defaultWidthFt: 20 },
  { id: "palm", label: "Palm", hint: "Fronds on a bare trunk", defaultHeightFt: 25, defaultWidthFt: 12 },
  { id: "shrub", label: "Shrub", hint: "Rounded mass", defaultHeightFt: 5, defaultWidthFt: 5 },
  { id: "groundcover", label: "Groundcover", hint: "Low spreading mat", defaultHeightFt: 1, defaultWidthFt: 4 },
  { id: "saguaro", label: "Saguaro", hint: "Column with raised arms", defaultHeightFt: 25, defaultWidthFt: 8 },
  { id: "columnar", label: "Columnar cactus", hint: "Upright column, no arms", defaultHeightFt: 12, defaultWidthFt: 3 },
  { id: "rosette", label: "Agave / rosette", hint: "Spiky rosette", defaultHeightFt: 3, defaultWidthFt: 4 },
  { id: "barrel", label: "Barrel cactus", hint: "Squat globe", defaultHeightFt: 2, defaultWidthFt: 2 },
];

// Drawn in a 48×48 box sitting on a ground line at y=44, so the symbols
// share a baseline and their relative masses read correctly side by side.
const PATHS: Record<PlaceholderSymbol, React.ReactNode> = {
  tree: (
    <>
      <path d="M24 44V26" />
      <path d="M24 30l-6-5M24 32l6-5" />
      <circle cx="24" cy="17" r="11" />
    </>
  ),
  palm: (
    <>
      <path d="M24 44V18" />
      <path d="M24 18c-5-6-11-7-15-5 5 0 10 3 15 5Z" />
      <path d="M24 18c5-6 11-7 15-5-5 0-10 3-15 5Z" />
      <path d="M24 18c-2-7-6-11-11-12 4 3 8 7 11 12Z" />
      <path d="M24 18c2-7 6-11 11-12-4 3-8 7-11 12Z" />
    </>
  ),
  shrub: (
    <>
      <path d="M8 44c0-11 7-19 16-19s16 8 16 19Z" />
    </>
  ),
  groundcover: (
    <>
      <path d="M5 44c2-6 6-9 10-9s6 2 9 5c3-3 5-5 9-5s8 3 10 9Z" />
    </>
  ),
  saguaro: (
    <>
      <rect x="20" y="8" width="8" height="36" rx="4" />
      <path d="M20 28h-7v-11M28 33h7v-11" />
    </>
  ),
  columnar: (
    <>
      <rect x="19" y="10" width="10" height="34" rx="5" />
      <path d="M19 26h-5a4 4 0 0 1-4-4v-4M29 22h5a4 4 0 0 1 4 4v3" />
    </>
  ),
  rosette: (
    <>
      <path d="M24 44 6 30M24 44l18-14M24 44 12 20M24 44l12-24M24 44V16M24 44l-6 -22M24 44l6-22" />
    </>
  ),
  barrel: (
    <>
      <ellipse cx="24" cy="32" rx="13" ry="12" />
      <path d="M24 20v24M15 22v20M33 22v20" />
    </>
  ),
};

export function SymbolGlyph({
  symbol,
  className = "",
  strokeWidth = 1.6,
}: {
  symbol: PlaceholderSymbol;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[symbol]}
      <path d="M6 44h36" strokeOpacity="0.35" />
    </svg>
  );
}

// Installed size by container, used to prefill each size row. These are
// nursery rules of thumb, not measurements — the designer overrides them.
export const INSTALLED_HEIGHT_FT: Record<string, number> = {
  "1g": 1,
  "5g": 2,
  "15g": 4,
  '24" Box': 7,
  '36" Box': 10,
  '48" Box': 13,
  '60" Box': 16,
};

// Mirrors InventoryStore.normalizePriceKey in the app and plantKey() in
// scripts/gen-catalog.mjs — keeps custom plants keyed like catalog ones.
export function plantKey(name: string): string {
  return (name.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(" ");
}
