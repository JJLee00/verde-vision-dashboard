import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import catalog from "@/lib/catalog.json";
import type { CatalogPlant } from "@/lib/price-stats";
import {
  toLibraryPlant,
  toLibraryPlants,
  type CustomPlant,
} from "@/lib/custom-plants";
import { loadPricesData } from "../prices/load-data";
import { PlantLibrary } from "./plant-library";

// Missing table: migration 014 hasn't been run yet (same codes the prices
// loader tolerates). The library still renders, minus placeholders.
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

export default async function PlantLibraryPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [data, { data: customRows, error: customError }] = await Promise.all([
    loadPricesData(supabase),
    supabase
      .from("custom_plants")
      .select(
        "id, name, botanical_name, key, symbol, mature_height_ft, mature_width_ft, sizes, photo_path, notes, status, updated_at"
      )
      .order("name"),
  ]);

  const customMissing = MISSING_TABLE.has(customError?.code ?? "");
  const custom = (customRows ?? []) as CustomPlant[];

  // project-media is a private bucket, so cards need short-lived signed URLs.
  const photoPaths = custom
    .map((c) => c.photo_path)
    .filter((p): p is string => !!p);
  const { data: signed } = photoPaths.length
    ? await supabase.storage
        .from("project-media")
        .createSignedUrls(photoPaths, 60 * 60)
    : { data: null };
  const urlByPath = new Map(
    (signed ?? []).map((s) => [s.path ?? "", s.signedUrl])
  );

  // Total placements per catalog key across the org's synced projects.
  const usage: Record<string, number> = {};
  for (const rows of data.usageLists) {
    for (const row of rows ?? []) {
      usage[row.key] = (usage[row.key] ?? 0) + row.count;
    }
  }

  return (
    <PlantLibrary
      plants={[
        ...toLibraryPlants(catalog.plants as CatalogPlant[]),
        ...custom.map((c) =>
          toLibraryPlant(c, urlByPath.get(c.photo_path ?? "") ?? null)
        ),
      ]}
      sizeOrder={catalog.sizeOrder}
      sizeOptions={catalog.sizeOrder.filter(
        (s) => !["Small", "Medium", "Large"].includes(s)
      )}
      priceOverrides={data.plantPrices}
      usage={usage}
      userId={user.id}
      setupNote={
        customMissing ? "supabase/migration-014-custom-plants.sql" : null
      }
      loadError={
        customError && !customMissing ? customError.message : null
      }
    />
  );
}
