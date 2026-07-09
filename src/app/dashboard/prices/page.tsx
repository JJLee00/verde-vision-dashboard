import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { splitCatalog, aggregateUsage, coverage } from "@/lib/price-stats";
import { PricesScreen } from "./prices-screen";
import { PriceSheets } from "./price-sheets";
import { loadPricesData } from "./load-data";

export type PriceSheet = {
  id: string;
  file_name: string;
  file_path: string;
  row_count: number | null;
  created_at: string;
  signedUrl?: string;
};

export default async function PlantPricesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { plantItems, plantSizes } = splitCatalog();
  const [data, { data: sheets }] = await Promise.all([
    loadPricesData(supabase),
    supabase
      .from("price_sheets")
      .select("id, file_name, file_path, row_count, created_at")
      .order("created_at", { ascending: false })
      .returns<PriceSheet[]>(),
  ]);

  const paths = (sheets ?? []).map((s) => s.file_path);
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage
      .from("price-sheets")
      .createSignedUrls(paths, 60 * 60);
    const byPath = new Map(
      (urls ?? [])
        .filter((u) => u.path && u.signedUrl)
        .map((u) => [u.path as string, u.signedUrl])
    );
    for (const sheet of sheets ?? []) {
      sheet.signedUrl = byPath.get(sheet.file_path) ?? undefined;
    }
  }

  const usage = aggregateUsage(data.usageLists, plantItems, plantSizes);
  const cov = coverage(plantItems, Object.keys(data.plantPrices));

  return (
    <PricesScreen
      title="Plant Prices"
      subtitle="Every plant in your Verde Vision library, priced by size. Estimates use these numbers automatically."
      laborNote="Per plant, by container size — a 5-gallon plant takes the same work no matter the species."
      tiles={[
        { label: "Favorite plant", value: usage.favorite ?? "—" },
        { label: "Most used size", value: usage.mostUsedSize ?? "—" },
        { label: "Plants priced", value: cov.itemsPriced },
      ]}
      usageNote={!usage.hasData}
      setupNote={data.setupNote}
      error={data.error}
      laborSizes={plantSizes}
      laborInitial={data.laborRates}
      plants={plantItems}
      sizes={plantSizes}
      pricesInitial={data.plantPrices}
    >
      <section className="mt-7 rounded-[14px] border border-edge bg-card p-6 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl text-ink">Price sheets</h2>
            <p className="mt-1 text-sm text-muted">
              Reference uploads (.xlsx, .xls, .csv). Estimates read the grid
              above — keep sheets here for your own records.
            </p>
          </div>
        </div>
        <div className="mt-5">
          <PriceSheets sheets={sheets ?? []} userId={user.id} />
        </div>
      </section>
    </PricesScreen>
  );
}
