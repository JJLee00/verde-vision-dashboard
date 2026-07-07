import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PriceSheets } from "./price-sheets";
import { PriceItems } from "./price-items";

export type PriceSheet = {
  id: string;
  file_name: string;
  file_path: string;
  row_count: number | null;
  created_at: string;
  signedUrl?: string;
};

export type PriceItem = {
  id: string;
  name: string;
  category: "plant" | "labor";
  price: number;
  unit: string;
  created_at: string;
};

export default async function PricesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: sheets, error: sheetsError }, { data: items, error: itemsError }] =
    await Promise.all([
      supabase
        .from("price_sheets")
        .select("id, file_name, file_path, row_count, created_at")
        .order("created_at", { ascending: false })
        .returns<PriceSheet[]>(),
      supabase
        .from("price_items")
        .select("id, name, category, price, unit, created_at")
        .order("category")
        .order("name")
        .returns<PriceItem[]>(),
    ]);

  // Signed URLs so sheets can be downloaded from the private bucket.
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

  const error = sheetsError ?? itemsError;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-12 lg:py-10">
      <header>
        <h1 className="font-serif text-4xl text-ink">Prices</h1>
        <p className="mt-1.5 text-sm text-muted">
          Your plant prices and labor rates. Upload a price sheet or enter
          prices by hand — these drive your project estimates.
        </p>
      </header>

      {error && (
        <p className="mt-4 text-sm text-clay">
          Could not load prices: {error.message}
        </p>
      )}

      <section className="mt-8 rounded-[14px] border border-edge bg-card p-6 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)] md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl text-ink">Price sheets</h2>
            <p className="mt-1 text-sm text-muted">
              Excel files (.xlsx, .xls, .csv) with your plant prices and labor
              rates.
            </p>
          </div>
        </div>
        <div className="mt-5">
          <PriceSheets sheets={sheets ?? []} userId={user.id} />
        </div>
      </section>

      <section className="mt-7 rounded-[14px] border border-edge bg-card p-6 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)] md:p-7">
        <h2 className="font-serif text-2xl text-ink">Manual prices</h2>
        <p className="mt-1 text-sm text-muted">
          Add individual plant prices (per item) or labor rates (per hour).
        </p>
        <div className="mt-5">
          <PriceItems items={items ?? []} />
        </div>
      </section>
    </div>
  );
}
