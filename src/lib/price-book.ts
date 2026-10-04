import type { SupabaseClient } from "@supabase/supabase-js";

// The org's price book, as every estimate reads it — here and on the headset.
//
// ONE rule (Oct 4 2026): a price is what the org typed on the Plant Prices or
// Hardscape Prices page, and a blank is $0. There is no fallback to the
// catalog's built-in numbers anywhere. Those were placeholders, and quietly
// quoting them made a bid look priced when nobody had priced it — and they
// were never the same placeholders on both sides, so the headset and this
// estimate could disagree about a plant the designer never touched.
//
// What lives where:
//   • plant_prices  "plant_key|size" → price. Plants and Small/Medium/Large
//                   hardscape items by container size, and surfaces under
//                   "surface:<style case>" with sizes "sqft" (material) and
//                   "labor_sqft" (labor) — see src/lib/surfaces.ts.
//   • labor_rates   size → labor per item of that size.

export type PriceBook = {
  /** "plant_key|size" → price. */
  prices: Record<string, number>;
  /** Container size → labor per item. */
  laborRates: Record<string, number>;
};

export const priceCell = (key: string, size: string) => `${key}|${size}`;

/** A grid price, or $0 when the org left that cell blank. */
export const gridPrice = (
  prices: Record<string, number>,
  key: string,
  size: string
): number => prices[priceCell(key, size)] ?? 0;

type PriceRow = { plant_key: unknown; size: unknown; price: unknown };

/** plant_prices rows → PriceBook.prices. */
export function pricesFromRows(rows: PriceRow[] | null | undefined) {
  const prices: Record<string, number> = {};
  for (const row of rows ?? []) {
    const price = Number(row.price);
    if (Number.isFinite(price)) {
      prices[priceCell(String(row.plant_key), String(row.size))] = price;
    }
  }
  return prices;
}

/**
 * Reads the org's price book.
 *
 * Scoped to the org by hand rather than left to RLS: the Vision Pro ingest
 * route calls this with the service role, where RLS is never consulted, and
 * an unscoped read would hand one firm's bid another firm's prices. No org,
 * or no tables yet (migration 005), is an empty book — every price $0.
 */
export async function loadPriceBook(
  supabase: SupabaseClient,
  orgId: string | null
): Promise<PriceBook> {
  if (!orgId) return { prices: {}, laborRates: {} };
  const [{ data: priceRows }, { data: rateRows }] = await Promise.all([
    supabase
      .from("plant_prices")
      .select("plant_key, size, price")
      .eq("org_id", orgId),
    supabase.from("labor_rates").select("size, rate").eq("org_id", orgId),
  ]);

  const prices = pricesFromRows(priceRows);
  const laborRates: Record<string, number> = {};
  for (const row of rateRows ?? []) {
    const rate = Number(row.rate);
    if (Number.isFinite(rate)) laborRates[String(row.size)] = rate;
  }
  return { prices, laborRates };
}
