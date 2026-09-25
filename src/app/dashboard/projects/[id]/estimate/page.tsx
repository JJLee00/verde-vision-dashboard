import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/org";
import {
  fromRow,
  sortItems,
  type EstimateItem,
  type EstimateSettings,
} from "@/lib/estimate";
import { EstimateBuilder, type SavedItem } from "./estimate-builder";

// The estimate builder: the one screen where a bid gets finished.
//
// The headset can only ever quote what was placed in AR, which is a fraction
// of a landscape job — no irrigation, demolition, delivery, dump fees or
// extra labor, because nobody models those in 3D. This page is where those
// rows get typed, and it deliberately lives on its own route rather than in a
// card on the project page: a 40-row bid needs the width.
//
// Everything here is migration-015-gated and degrades the same way the
// project page's migration-009 fields do — the screen renders, explains
// itself, and stays read-only until the SQL has been run.

export const metadata = { title: "Estimate — Verde Vision" };

type PageData = {
  id: string;
  name: string;
  clientId: string;
  items: EstimateItem[];
  settings: EstimateSettings;
  savedItems: SavedItem[];
  canEdit: boolean;
  isOwner: boolean;
  // False until migration-015 has been run: no estimate_items table, no
  // estimate settings columns.
  schemaReady: boolean;
  readOnly: boolean; // dev fixture
};

const DEFAULT_SETTINGS: EstimateSettings = {
  taxRate: 0,
  depositPercent: 0,
  detail: "itemized",
};

// A believable bid for /dashboard/projects/fixture/estimate in development:
// AR-derived plant and hardscape rows plus the hand-typed lines that are the
// entire reason this screen exists. Read-only — nothing here is in a table.
function buildFixtureData(): PageData {
  const raw: Array<Partial<EstimateItem> & { id: string }> = [
    { id: "f1", sortOrder: 10, description: '(15g) Green Hopseed', category: "plant", quantity: 9, unit: "each", unitPrice: 118, source: "ar", arKey: "plant:green hopseed:15g" },
    { id: "f2", sortOrder: 20, description: '(5g) Regal Mist', category: "plant", quantity: 14, unit: "each", unitPrice: 42, source: "ar", arKey: "plant:regal mist:5g" },
    { id: "f3", sortOrder: 30, description: '(24" Box) Texas Ebony', category: "plant", quantity: 2, unit: "each", unitPrice: 385, source: "ar", arKey: "plant:texas ebony:24in box" },
    { id: "f4", sortOrder: 40, description: "Sierra paver patio", category: "hardscape", quantity: 340, unit: "ft²", unitPrice: 14.25, source: "ar", arKey: "hardscape:a41f" },
    { id: "f5", sortOrder: 50, description: "Irrigation system modification", category: "irrigation", quantity: 1, unit: "ls", unitPrice: 1200, note: "Includes 2 valves; excludes trenching under the drive." },
    { id: "f6", sortOrder: 60, description: "Remove 3 oleanders + stump grind", category: "demolition", quantity: 1, unit: "ls", unitPrice: 850 },
    { id: "f7", sortOrder: 70, description: "Dump fees", category: "fee", quantity: 2, unit: "load", unitPrice: 225 },
    { id: "f8", sortOrder: 80, description: "Delivery", category: "delivery", quantity: 1, unit: "trip", unitPrice: 185 },
    { id: "f9", sortOrder: 90, description: "Install labor", category: "labor", quantity: 36, unit: "hr", unitPrice: 62.5, taxable: false },
  ];
  return {
    id: "fixture",
    name: "Hoffman Residence",
    clientId: "fixture",
    items: raw.map((r) => ({
      category: "other",
      quantity: 1,
      unit: "each",
      unitPrice: 0,
      taxable: true,
      note: null,
      source: "manual",
      arKey: null,
      priceOverridden: false,
      ...r,
      total: Math.round((r.quantity ?? 1) * (r.unitPrice ?? 0) * 100) / 100,
    })) as EstimateItem[],
    settings: { taxRate: 8.6, depositPercent: 30, detail: "itemized" },
    savedItems: [
      { id: "s1", name: "Dump fees", category: "fee", price: 225, unit: "load" },
      { id: "s2", name: "Delivery", category: "delivery", price: 185, unit: "trip" },
      { id: "s3", name: "Tree trimming", category: "service", price: 145, unit: "hr" },
      { id: "s4", name: "Misc. irrigation materials", category: "irrigation", price: 350, unit: "ls" },
      { id: "s5", name: "Install labor", category: "labor", price: 62.5, unit: "hr" },
    ],
    canEdit: false,
    isOwner: true,
    schemaReady: true,
    readOnly: true,
  };
}

async function loadPageData(id: string): Promise<PageData | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The base row predates everything; the settings columns and the rows
  // themselves arrive with migration-015, so they get their own selects and
  // are read tolerantly. Saved Items is the org price book (migration 003,
  // org-scoped by 007, widened past 'plant'/'labor' by 015).
  const [baseRes, settingsRes, itemsRes, savedRes, membership] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, client_id")
        .eq("id", id)
        .single(),
      supabase
        .from("projects")
        .select("tax_rate, deposit_percent, estimate_detail")
        .eq("id", id)
        .single(),
      supabase
        .from("estimate_items")
        .select(
          "id, sort_order, description, category, quantity, unit, unit_price, total, taxable, note, source, ar_key, price_overridden"
        )
        .eq("project_id", id),
      supabase
        .from("price_items")
        .select("id, name, category, price, unit")
        .order("name"),
      getMembership(supabase, user.id),
    ]);

  const base = baseRes.data;
  if (baseRes.error || !base) return null;

  const schemaReady = !settingsRes.error && !itemsRes.error;

  const settings: EstimateSettings = settingsRes.data
    ? {
        taxRate: Number(settingsRes.data.tax_rate ?? 0),
        depositPercent: Number(settingsRes.data.deposit_percent ?? 0),
        detail:
          settingsRes.data.estimate_detail === "grouped"
            ? "grouped"
            : "itemized",
      }
    : DEFAULT_SETTINGS;

  return {
    id: base.id,
    name: base.name,
    clientId: base.client_id,
    items: sortItems((itemsRes.data ?? []).map(fromRow)),
    settings,
    // Pre-015 the price book still answers, just without the new categories.
    savedItems: (savedRes.data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      category: r.category as string,
      price: Number(r.price),
      unit: (r.unit as string) ?? "each",
    })),
    canEdit:
      schemaReady &&
      (base.client_id === user.id || membership?.role === "owner"),
    isOwner: membership?.role === "owner",
    schemaReady,
    readOnly: false,
  };
}

export default async function EstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data =
    id === "fixture" && process.env.NODE_ENV === "development"
      ? buildFixtureData()
      : await loadPageData(id);
  if (!data) notFound();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-12 lg:py-10">
      <Link
        href={`/dashboard/projects/${data.id}`}
        className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted transition hover:text-accent"
      >
        ← {data.name}
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl text-ink">Estimate</h1>
          <p className="mt-1.5 max-w-xl text-sm text-muted">
            Plants and surfaces come from the design. Everything else —
            irrigation, demolition, delivery, dump fees, labor — you add here.
          </p>
        </div>
        {data.readOnly && (
          <span className="rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-gold">
            Sample — read only
          </span>
        )}
      </div>

      {!data.schemaReady && (
        <div className="mt-6 rounded-[14px] border border-gold/40 bg-gold/[0.07] p-5">
          <h2 className="font-serif text-lg text-ink">
            Waiting on migration 015
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            The estimate tables aren&apos;t in this database yet. Run{" "}
            <code className="rounded bg-ink/[0.07] px-1.5 py-0.5 font-mono text-[0.78rem]">
              supabase/migration-015-estimate-builder.sql
            </code>{" "}
            in the Supabase SQL editor and reload — the screen below is live the
            moment it lands.
          </p>
        </div>
      )}

      <EstimateBuilder
        projectId={data.id}
        initialItems={data.items}
        initialSettings={data.settings}
        savedItems={data.savedItems}
        canEdit={data.canEdit}
        isOwner={data.isOwner}
      />

      <p className="mt-8 text-xs text-faint">
        The grand total syncs back to the project record, so the dashboard card
        and this bid always agree.
      </p>
    </div>
  );
}
