import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/org";
import {
  ESTIMATE_ITEM_COLUMNS,
  ESTIMATE_ITEM_COLUMNS_PRE_023,
  fromRow,
  isMissingColumn,
  sortItems,
  type EstimateItem,
  type EstimateSettings,
} from "@/lib/estimate";
import {
  FIXTURE_ITEMS,
  FIXTURE_PROJECT_META,
  FIXTURE_SAVED_ITEMS,
  FIXTURE_SETTINGS,
} from "@/lib/estimate-fixture";
import { EstimateBuilder, type SavedItem } from "./estimate-builder";

// The estimate builder: the one screen where a bid gets finished.
//
// Full screen (Oct 4 2026), like the 3D viewer — the dashboard's menu is
// hidden on this route (see ../../../chrome.tsx). A 40-row bid needs the
// width, and the people finishing it live in QuickBooks: the builder is a
// plain ruled grid on purpose.
//
// The headset can only ever quote what was placed in AR, which is a fraction
// of a landscape job — no irrigation, demolition, delivery, dump fees or
// extra labor, because nobody models those in 3D. This page is where those
// rows get typed, and it deliberately lives on its own route rather than in a
// card on the project page: a 40-row bid needs the width.
//
// Everything here is migration-016-gated and degrades the same way the
// project page's migration-009 fields do — the screen renders, explains
// itself, and stays read-only until the SQL has been run.

export const metadata = { title: "Estimate — Verde Vision" };

type PageData = {
  id: string;
  name: string;
  clientId: string;
  items: EstimateItem[];
  settings: EstimateSettings;
  terms: string;
  savedItems: SavedItem[];
  canEdit: boolean;
  isOwner: boolean;
  // False until migration-016 has been run: no estimate_items table, no
  // estimate settings columns.
  schemaReady: boolean;
  // False until migration-023: no per-line labor. The bid shows, read-only.
  laborReady: boolean;
  readOnly: boolean; // dev fixture
};

const DEFAULT_SETTINGS: EstimateSettings = {
  taxRate: 0,
  depositPercent: 0,
  detail: "itemized",
};

function buildFixtureData(): PageData {
  return {
    id: "fixture",
    name: FIXTURE_PROJECT_META.name,
    clientId: "fixture",
    items: FIXTURE_ITEMS,
    settings: FIXTURE_SETTINGS,
    terms: "",
    savedItems: FIXTURE_SAVED_ITEMS,
    canEdit: false,
    isOwner: true,
    schemaReady: true,
    laborReady: true,
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
  // themselves arrive with migration-016, so they get their own selects and
  // are read tolerantly. Saved Items is the org price book (migration 003,
  // org-scoped by 007, widened past 'plant'/'labor' by 016).
  const [baseRes, settingsRes, { res: itemsRes, laborReady }, savedRes, membership] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, client_id")
        .eq("id", id)
        .single(),
      supabase
        .from("projects")
        .select("tax_rate, deposit_percent, estimate_detail, estimate_terms")
        .eq("id", id)
        .single(),
      supabase
        .from("estimate_items")
        .select(ESTIMATE_ITEM_COLUMNS)
        .eq("project_id", id)
        .then(async (res) => ({
          res: isMissingColumn(res.error?.code)
            ? await supabase
                .from("estimate_items")
                .select(ESTIMATE_ITEM_COLUMNS_PRE_023)
                .eq("project_id", id)
            : res,
          laborReady: !isMissingColumn(res.error?.code),
        })),
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
    terms: settingsRes.data?.estimate_terms ?? "",
    // Pre-016 the price book still answers, just without the new categories.
    savedItems: (savedRes.data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      category: r.category as string,
      price: Number(r.price),
      unit: (r.unit as string) ?? "each",
    })),
    canEdit:
      schemaReady &&
      laborReady &&
      (base.client_id === user.id || membership?.role === "owner"),
    isOwner: membership?.role === "owner",
    schemaReady,
    laborReady,
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

  const notice = !data.schemaReady
    ? {
        title: "Waiting on migration 016",
        file: "supabase/migration-016-estimate-builder.sql",
        body: "The estimate tables aren't in this database yet.",
      }
    : !data.laborReady
      ? {
          title: "Waiting on migration 023",
          file: "supabase/migration-023-labor-per-line.sql",
          body: "Lines can't carry their own labor yet, so the estimate is read-only.",
        }
      : null;

  return (
    <EstimateBuilder
      projectId={data.id}
      projectName={data.name}
      initialItems={data.items}
      initialSettings={data.settings}
      initialTerms={data.terms}
      savedItems={data.savedItems}
      canEdit={data.canEdit}
      isOwner={data.isOwner}
      sample={data.readOnly}
    >
      {notice && (
        <div className="border border-gold/50 bg-gold/[0.07] px-4 py-3 text-sm text-body">
          <span className="font-semibold text-ink">{notice.title}.</span>{" "}
          {notice.body} Run{" "}
          <code className="bg-ink/[0.07] px-1.5 py-0.5 font-mono text-[0.78rem]">
            {notice.file}
          </code>{" "}
          in the Supabase SQL editor and reload.
        </div>
      )}
    </EstimateBuilder>
  );
}
