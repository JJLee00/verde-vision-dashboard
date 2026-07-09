import { createClient } from "@/lib/supabase/server";
import type { UsageRow } from "@/lib/price-stats";

// Missing table: Postgres 42P01 / PostgREST PGRST205 (migration 005).
// Missing column: Postgres 42703 / PostgREST PGRST204 (migration 006).
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);
const MISSING_COLUMN = new Set(["42703", "PGRST204"]);

// Loads everything both prices pages need. Tolerates not-yet-run
// migrations: the page renders with a setup note instead of erroring.
export async function loadPricesData(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [
    { data: laborRows, error: laborError },
    { data: priceRows, error: pricesError },
    { data: usageRows, error: usageError },
  ] = await Promise.all([
    supabase.from("labor_rates").select("size, rate"),
    supabase.from("plant_prices").select("plant_key, size, price"),
    supabase.from("projects").select("plant_usage"),
  ]);

  const gridMissing =
    MISSING_TABLE.has(laborError?.code ?? "") ||
    MISSING_TABLE.has(pricesError?.code ?? "");
  const usageMissing = MISSING_COLUMN.has(usageError?.code ?? "");

  const migrations = [
    ...(gridMissing ? ["supabase/migration-005-price-grid.sql"] : []),
    ...(usageMissing ? ["supabase/migration-006-estimate-usage.sql"] : []),
  ];

  const realError = [laborError, pricesError, usageError].find(
    (e) =>
      e && !MISSING_TABLE.has(e.code ?? "") && !MISSING_COLUMN.has(e.code ?? "")
  );

  return {
    laborRates: Object.fromEntries(
      (laborRows ?? []).map((r) => [r.size as string, Number(r.rate)])
    ),
    plantPrices: Object.fromEntries(
      (priceRows ?? []).map((r) => [
        `${r.plant_key}|${r.size}`,
        Number(r.price),
      ])
    ),
    usageLists: (usageRows ?? []).map(
      (r) => (r.plant_usage as UsageRow[] | null) ?? null
    ),
    setupNote: migrations.length > 0 ? migrations.join(" and ") : null,
    error: realError?.message ?? null,
  };
}
