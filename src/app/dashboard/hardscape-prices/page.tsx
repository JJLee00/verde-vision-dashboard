import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { splitCatalog, aggregateUsage } from "@/lib/price-stats";
import { PricesScreen } from "../prices/prices-screen";
import { loadPricesData } from "../prices/load-data";

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
    />
  );
}
