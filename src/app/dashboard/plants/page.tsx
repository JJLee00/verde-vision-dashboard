import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import catalog from "@/lib/catalog.json";
import type { CatalogPlant } from "@/lib/price-stats";
import { loadPricesData } from "../prices/load-data";
import { PlantLibrary } from "./plant-library";

export default async function PlantLibraryPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const data = await loadPricesData(supabase);

  // Total times each catalog item has been placed across the org's
  // synced projects — the library's demand signal.
  const usage: Record<string, number> = {};
  for (const rows of data.usageLists) {
    for (const row of rows ?? []) {
      usage[row.key] = (usage[row.key] ?? 0) + row.count;
    }
  }

  return (
    <PlantLibrary
      plants={catalog.plants as CatalogPlant[]}
      sizeOrder={catalog.sizeOrder}
      priceOverrides={data.plantPrices}
      usage={usage}
    />
  );
}
