import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { splitCatalog, aggregateUsage } from "@/lib/price-stats";
import { PricesScreen } from "../prices/prices-screen";
import { loadPricesData } from "../prices/load-data";
import { SurfacePrices } from "../prices/surface-prices";

export default async function HardscapePricesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { hardscapeItems, hardscapeSizes } = splitCatalog();
  const data = await loadPricesData(supabase);

  const usage = aggregateUsage(data.usageLists, hardscapeItems, hardscapeSizes);

  return (
    <PricesScreen
      title="Hardscape Prices"
      subtitle="Boulders, pools, and specimen plants — everything sold Small / Medium / Large. Estimates use these numbers automatically."
      laborNote="Per item, by size — placing a large boulder is the same work whichever boulder it is."
      tiles={[
        { label: "Favorite item", value: usage.favorite ?? "—" },
        { label: "Most used size", value: usage.mostUsedSize ?? "—" },
      ]}
      usageNote={!usage.hasData}
      setupNote={data.setupNote}
      error={data.error}
      laborSizes={hardscapeSizes}
      laborInitial={data.laborRates}
      plants={hardscapeItems}
      sizes={hardscapeSizes}
      pricesInitial={data.plantPrices}
    >
      <section className="mt-7 rounded-[14px] border border-edge bg-card p-6 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)] md:p-7">
        <h2 className="font-serif text-2xl text-ink">Surfaces</h2>
        <p className="mt-1 text-sm text-muted">
          Traced areas — pavers, turf, decomposed granite — priced per square
          foot. A blank is $0 on estimates and in the headset.
        </p>
        <div className="mt-5">
          <SurfacePrices initial={data.plantPrices} />
        </div>
      </section>
    </PricesScreen>
  );
}
