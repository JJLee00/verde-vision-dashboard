import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/org";
import { fromRow, type EstimateSettings } from "@/lib/estimate";
import { renderEstimatePDF } from "@/lib/pdf/estimate-pdf";
import type { OrgBrand } from "@/lib/pdf/doc";
import {
  FIXTURE_ITEMS,
  FIXTURE_ORG,
  FIXTURE_PROJECT_META,
  FIXTURE_SETTINGS,
} from "@/lib/estimate-fixture";

/**
 * Generates the proposal PDF for one project, from the estimate rows.
 *
 * GET /dashboard/projects/{id}/estimate/pdf
 *   ?detail=itemized|grouped   preview a mode without saving it
 *   ?download=1                attachment rather than inline
 *
 * Rendered on demand rather than stored: the rows are the source of truth,
 * so a PDF on disk can only ever be a stale copy of them. Storing a frozen
 * copy is for publishing a revision (plan doc §5) — an approved bid must not
 * be editable underneath the client — and that belongs with the versions
 * work, not here.
 */

// pdfkit is a Node library (fs, streams, font files) — it cannot run on edge.
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const detailParam = request.nextUrl.searchParams.get("detail");
  const download = request.nextUrl.searchParams.get("download") === "1";

  const loaded =
    id === "fixture" && process.env.NODE_ENV === "development"
      ? loadFixture()
      : await loadProject(id);

  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  const settings: EstimateSettings = {
    ...loaded.settings,
    detail:
      detailParam === "grouped"
        ? "grouped"
        : detailParam === "itemized"
          ? "itemized"
          : loaded.settings.detail,
  };

  const pdf = await renderEstimatePDF({
    project: loaded.project,
    org: loaded.org,
    items: loaded.items,
    settings,
    terms: loaded.terms,
  });

  const safeName = loaded.project.name.replace(/[^\w\s-]/g, "").trim() || "estimate";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName} estimate.pdf"`,
      // A bid changes the moment a row does; never let a proxy hold one.
      "Cache-Control": "no-store",
    },
  });
}

type Loaded = {
  project: { name: string; date: string | null; address: string | null; contactEmail: string | null };
  org: OrgBrand;
  items: ReturnType<typeof fromRow>[];
  settings: EstimateSettings;
  terms: string | null;
};

function loadFixture(): Loaded {
  return {
    project: FIXTURE_PROJECT_META,
    org: FIXTURE_ORG,
    items: FIXTURE_ITEMS,
    settings: FIXTURE_SETTINGS,
    terms: null,
  };
}

async function loadProject(id: string): Promise<Loaded | { error: string; status: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in", status: 401 };

  // Same migration-gated split as the estimate page: the base row is old,
  // the record fields are 009, the estimate settings and rows are 015.
  const [baseRes, recRes, settingsRes, itemsRes, membership] = await Promise.all([
    supabase.from("projects").select("id, name, project_date").eq("id", id).single(),
    supabase.from("projects").select("address, contact_email").eq("id", id).single(),
    supabase
      .from("projects")
      .select("tax_rate, deposit_percent, estimate_detail, estimate_terms")
      .eq("id", id)
      .single(),
    supabase
      .from("estimate_items")
      .select(
        "id, sort_order, description, category, quantity, unit, unit_price, total, taxable, note, source, ar_key, price_overridden"
      )
      .eq("project_id", id),
    getMembership(supabase, user.id),
  ]);

  if (baseRes.error || !baseRes.data) return { error: "Project not found", status: 404 };
  if (itemsRes.error) {
    return {
      error: "Estimate tables are not in this database yet — run migration-015.",
      status: 409,
    };
  }

  return {
    project: {
      name: baseRes.data.name,
      date: baseRes.data.project_date,
      address: recRes.data?.address ?? null,
      contactEmail: recRes.data?.contact_email ?? null,
    },
    org: await loadOrgBrand(supabase, membership?.orgId ?? null),
    items: (itemsRes.data ?? []).map(fromRow),
    settings: {
      taxRate: Number(settingsRes.data?.tax_rate ?? 0),
      depositPercent: Number(settingsRes.data?.deposit_percent ?? 0),
      detail: settingsRes.data?.estimate_detail === "grouped" ? "grouped" : "itemized",
    },
    terms: settingsRes.data?.estimate_terms ?? null,
  };
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// Tolerant on purpose: before migration-015 the branding columns don't
// exist, and a proposal that prints under a bare company name is far better
// than one that 500s.
async function loadOrgBrand(
  supabase: ServerClient,
  orgId: string | null
): Promise<OrgBrand> {
  const blank: OrgBrand = {
    name: "Verde Vision",
    logo: null,
    phone: null,
    email: null,
    address: null,
    website: null,
    licenseNumber: null,
    terms: null,
  };
  if (!orgId) return blank;

  const [nameRes, brandRes] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    supabase
      .from("organizations")
      .select("logo_path, phone, email, address, website, license_number, terms")
      .eq("id", orgId)
      .maybeSingle(),
  ]);

  const brand = brandRes.data;
  let logo: Buffer | null = null;
  if (brand?.logo_path) {
    // Never let a missing or unreadable logo take the proposal down.
    try {
      const { data } = await supabase.storage
        .from("org-assets")
        .download(brand.logo_path);
      if (data) logo = Buffer.from(await data.arrayBuffer());
    } catch {
      logo = null;
    }
  }

  return {
    name: nameRes.data?.name || blank.name,
    logo,
    phone: brand?.phone ?? null,
    email: brand?.email ?? null,
    address: brand?.address ?? null,
    website: brand?.website ?? null,
    licenseNumber: brand?.license_number ?? null,
    terms: brand?.terms ?? null,
  };
}
