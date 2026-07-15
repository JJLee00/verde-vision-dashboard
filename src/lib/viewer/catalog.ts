// Species metadata for the living-blueprint viewer, keyed by the app's
// PlacedPlant.plantModelName. Mirrors Test/Test/Models/PlantItem.swift
// (sampleCatalog) in the Vision Pro repo — keep the two in sync when a
// species is added there.
//
// renderHeightFt caps how tall the stylized glyph draws; several species
// (fan palm, saguaro) have mature heights that would dwarf the drawing.

export type GlyphKind =
  | "tree"
  | "palm"
  | "saguaro"
  | "columnar"
  | "barrel"
  | "rosette"
  | "shrub"
  | "boulder"
  | "poolPrefab"
  | "light";

export type SpeciesMeta = {
  code: string; // short plan-symbol label, e.g. "HM"
  name: string;
  botanical?: string;
  kind: GlyphKind;
  matureHeightFt: number;
  matureWidthFt: number;
  renderHeightFt: number;
  // Catalog default installed price by ContainerSize.SizeType raw value.
  // The designer's own Prices-tab entries override these by plant name.
  prices: Record<string, number>;
};

export const CATALOG: Record<string, SpeciesMeta> = {
  "Aloe Vera": {
    code: "AV",
    name: "Aloe Vera",
    botanical: "Aloe barbadensis miller",
    kind: "rosette",
    matureHeightFt: 2,
    matureWidthFt: 2,
    renderHeightFt: 2,
    prices: { "5g": 55, "15g": 120 },
  },
  AgaveAmericana: {
    code: "AG",
    name: "Agave Americana",
    botanical: "Agave americana",
    kind: "rosette",
    matureHeightFt: 6,
    matureWidthFt: 8,
    renderHeightFt: 5,
    prices: { "5g": 70, "15g": 125 },
  },
  MexicanFencePost: {
    code: "MFP",
    name: "Mexican Fence Post",
    botanical: "Pachycereus marginatus",
    kind: "columnar",
    matureHeightFt: 10,
    matureWidthFt: 3,
    renderHeightFt: 9,
    prices: { "5g": 85, "15g": 180 },
  },
  HoneyMesquite: {
    code: "HM",
    name: "Honey Mesquite",
    botanical: "Prosopis glandulosa",
    kind: "tree",
    matureHeightFt: 15,
    matureWidthFt: 20,
    renderHeightFt: 15,
    prices: { "15g": 125, '24" Box': 275, '36" Box': 450, '48" Box': 750 },
  },
  Orange_Tree: {
    code: "OT",
    name: "Orange Tree",
    botanical: "Citrus sinensis",
    kind: "tree",
    matureHeightFt: 20,
    matureWidthFt: 15,
    renderHeightFt: 13,
    prices: { "15g": 150, '24" Box': 325, '36" Box': 550 },
  },
  GrayBoulder: {
    code: "RK",
    name: "Gray Boulder",
    botanical: "Granite, surface select",
    kind: "boulder",
    matureHeightFt: 3,
    matureWidthFt: 3,
    renderHeightFt: 2.4,
    prices: { Small: 95, Medium: 195, Large: 350 },
  },
  GoldenBarrel: {
    code: "GB",
    name: "Golden Barrel Cactus",
    botanical: "Echinocactus grusonii",
    kind: "barrel",
    matureHeightFt: 3,
    matureWidthFt: 2,
    renderHeightFt: 1.6,
    prices: { "5g": 65, "15g": 140 },
  },
  MexFanPalm: {
    code: "FP",
    name: "Mexican Fan Palm",
    botanical: "Washingtonia robusta",
    kind: "palm",
    matureHeightFt: 70,
    matureWidthFt: 10,
    renderHeightFt: 26,
    prices: { '24" Box': 295, '36" Box': 495, '48" Box': 795 },
  },
  SaguaroSpear: {
    code: "SG",
    name: "Saguaro",
    botanical: "Carnegiea gigantea",
    kind: "saguaro",
    matureHeightFt: 40,
    matureWidthFt: 3,
    renderHeightFt: 14,
    prices: { Small: 600, Medium: 900, Large: 1200 },
  },
  ArgentineToothpick: {
    code: "AT",
    name: "Argentine Toothpick",
    botanical: "Stetsonia coryne",
    kind: "columnar",
    matureHeightFt: 30,
    matureWidthFt: 10,
    renderHeightFt: 11,
    prices: { "15g": 185, '24" Box': 395 },
  },
  FlatBoulder: {
    code: "RKF",
    name: "Flat Boulder",
    botanical: "Granite, surface select",
    kind: "boulder",
    matureHeightFt: 1,
    matureWidthFt: 4,
    renderHeightFt: 1.1,
    prices: { Small: 75, Medium: 165, Large: 295 },
  },
  AZBoulder1: {
    code: "AZ1",
    name: "AZ Boulder",
    botanical: "Granite, surface select",
    kind: "boulder",
    matureHeightFt: 1,
    matureWidthFt: 4,
    renderHeightFt: 1.3,
    prices: { Small: 75, Medium: 165, Large: 295 },
  },
  SwimmingPool: {
    code: "SP",
    name: "Swimming Pool",
    kind: "poolPrefab",
    matureHeightFt: 3,
    matureWidthFt: 6,
    renderHeightFt: 0,
    prices: { Small: 32000, Large: 58000 },
  },
  NightUplight: {
    code: "UL",
    name: "Landscape Uplight",
    kind: "light",
    matureHeightFt: 0.7,
    matureWidthFt: 0.2,
    renderHeightFt: 0.7,
    prices: { Small: 45 },
  },
  NightFloodlight: {
    code: "FL",
    name: "Flood Light",
    kind: "light",
    matureHeightFt: 0.4,
    matureWidthFt: 0.3,
    renderHeightFt: 0.4,
    prices: { Small: 65 },
  },
  NightPathlight: {
    code: "PL",
    name: "Path Light",
    kind: "light",
    matureHeightFt: 1.5,
    matureWidthFt: 0.5,
    renderHeightFt: 1.5,
    prices: { Small: 38 },
  },
  TotemPole: {
    code: "TP",
    name: "Totem Pole Cactus",
    botanical: "Pachycereus schottii f. monstrosus",
    kind: "columnar",
    matureHeightFt: 12,
    matureWidthFt: 2,
    renderHeightFt: 10,
    prices: { "5g": 95, "15g": 195 },
  },
  AgaveTruncata: {
    code: "AGT",
    name: "Agave Truncata",
    botanical: "Agave parryi var. truncata",
    kind: "rosette",
    matureHeightFt: 2,
    matureWidthFt: 3,
    renderHeightFt: 2,
    prices: { "5g": 75, "15g": 145 },
  },
  TropicalAgave: {
    code: "TAG",
    name: "Tropical Agave",
    kind: "rosette",
    matureHeightFt: 3,
    matureWidthFt: 4,
    renderHeightFt: 3,
    prices: { "5g": 75, "15g": 145 },
  },
  Firebarrel: {
    code: "FB",
    name: "Fire Barrel Cactus",
    kind: "barrel",
    matureHeightFt: 3,
    matureWidthFt: 2,
    renderHeightFt: 1.6,
    prices: { "5g": 70, "15g": 150 },
  },
  AgaveGeminiflora: {
    code: "AGM",
    name: "Agave Geminiflora",
    kind: "rosette",
    matureHeightFt: 2,
    matureWidthFt: 3,
    renderHeightFt: 2,
    prices: { "5g": 70, "15g": 140 },
  },
  YellowBells: {
    code: "YB",
    name: "Yellow Bells",
    botanical: "Tecoma stans",
    kind: "shrub",
    matureHeightFt: 15,
    matureWidthFt: 10,
    renderHeightFt: 9,
    prices: { "5g": 65, "15g": 130 },
  },
};

/** Meta for a model the catalog doesn't know yet (new scans land in the
 *  app before anyone updates this file). Draws a generic rosette at a
 *  modest size and shows the raw model name in the rail. */
export function speciesMeta(modelName: string): SpeciesMeta {
  const known = CATALOG[modelName];
  if (known) return known;
  const code = modelName
    .replace(/[^A-Za-z]/g, "")
    .replace(/[a-z]/g, "")
    .slice(0, 3) || modelName.slice(0, 2).toUpperCase();
  return {
    code,
    name: modelName.replace(/[_-]/g, " "),
    kind: "rosette",
    matureHeightFt: 4,
    matureWidthFt: 4,
    renderHeightFt: 4,
    prices: {},
  };
}
