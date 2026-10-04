import catalog from "@/lib/catalog.json";
import { gridPrice, type PriceBook } from "@/lib/price-book";
import type { HardscapeAreaJSON } from "@/lib/viewer/types";

// Surface pricing for the estimate — the traced areas (pavers, turf,
// decomposed granite…), billed per square foot rather than per container.
//
// The STYLES are generated from the app's HardscapeStyle (npm run
// gen:catalog reads HardscapeArea.swift). Their PRICES are the org's, typed
// in the Surfaces card on the Hardscape Prices page and stored in
// plant_prices under "surface:<case>" — a blank is $0, here and on the
// headset, which reads the same rows.

export type SurfaceStyle = {
  /** HardscapeStyle case name, e.g. "paver". */
  case: string;
  /** Its raw value — what project_json carries, e.g. "Paving Stones 081". */
  style: string;
};

/** plant_prices sizes a surface is priced under: material and labor per ft². */
export const SURFACE_PRICE_SIZE = "sqft";
export const SURFACE_LABOR_SIZE = "labor_sqft";
export const surfacePriceKey = (style: SurfaceStyle) => `surface:${style.case}`;

/** The org's material and labor price per ft² for a style; blanks are $0. */
export function surfaceRates(style: SurfaceStyle, book: PriceBook) {
  const key = surfacePriceKey(style);
  return {
    price: gridPrice(book.prices, key, SURFACE_PRICE_SIZE),
    labor: gridPrice(book.prices, key, SURFACE_LABOR_SIZE),
  };
}

export const STYLES: SurfaceStyle[] =
  (catalog as unknown as { surfaces?: SurfaceStyle[] }).surfaces ?? [];
const BY_RAW = new Map(STYLES.map((s) => [s.style, s]));
const BY_CASE = new Map(STYLES.map((s) => [s.case, s]));

/**
 * The style a saved area renders as, mirroring HardscapeStyle's lenient
 * decoder: "Pavers" is the paver style's pre-rename raw value, and anything
 * unrecognised (the retired "Pool") falls back to concrete — which is what
 * the headset drew and priced it as.
 */
export function surfaceStyle(raw: string): SurfaceStyle | null {
  return (
    BY_RAW.get(raw) ??
    (raw === "Pavers" ? BY_CASE.get("paver") : undefined) ??
    BY_CASE.get("concrete") ??
    null
  );
}

const SQ_FT_PER_SQ_M = 10.7639;

/**
 * Plan area in square feet: the shoelace formula on (x, z), the same
 * computation as HardscapeArea.areaSquareMeters. Fewer than three corners is
 * not an area, and the headset leaves those off its estimate too.
 */
export function surfaceSqFt(area: HardscapeAreaJSON): number {
  const v = area.vertices ?? [];
  if (v.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    sum += a.positionX * b.positionZ - b.positionX * a.positionZ;
  }
  return (Math.abs(sum) / 2) * SQ_FT_PER_SQ_M;
}
