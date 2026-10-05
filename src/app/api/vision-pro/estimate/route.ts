import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ESTIMATE_ITEM_COLUMNS,
  ESTIMATE_ITEM_COLUMNS_PRE_023,
  isMissingColumn,
} from "@/lib/estimate";

/**
 * A project's estimate as the dashboard holds it — the bid of record.
 *
 * GET /api/vision-pro/estimate?project_id={uuid}
 * Header: `x-api-key: <VISION_PRO_API_KEY>` — the same key, and the same
 * trust model, as /api/project-changes.
 *
 * The headset's estimate panel shows THIS bid (Oct 5 2026) instead of pricing
 * the design itself: lines keep the price they were given, the office's
 * hand-typed lines and typed-over prices are in it, and so are tax and the
 * deposit. The headset layers the design changes made since its last sync on
 * top, with the same rules rebuildPlantRows applies (see
 * src/lib/estimate-parity.json, which both codebases check against), so the
 * total it shows is the total this estimate will have once it syncs.
 *
 * Read-only on purpose: a GET never rebuilds rows.
 *
 * Response:
 *   {
 *     "tax_rate": 8.6,
 *     "deposit_percent": 30,
 *     "lines": [{ "ar_key", "description", "note", "quantity", "unit",
 *                 "unit_price", "labor_unit_price", "taxable", "source",
 *                 "price_overridden", "labor_overridden", "sort_order" }]
 *   }
 */
export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.VISION_PRO_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = request.nextUrl.searchParams.get("project_id");
  if (!projectId) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: project } = await supabase
    .from("projects")
    .select("id, tax_rate, deposit_percent")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const first = await supabase
    .from("estimate_items")
    .select(ESTIMATE_ITEM_COLUMNS)
    .eq("project_id", projectId);
  // Before migration 023 there are no labor columns; every line has none.
  const result = isMissingColumn(first.error?.code)
    ? await supabase
        .from("estimate_items")
        .select(ESTIMATE_ITEM_COLUMNS_PRE_023)
        .eq("project_id", projectId)
    : first;
  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  type Row = Record<string, unknown>;
  const rows = (result.data ?? []) as Row[];
  return NextResponse.json({
    tax_rate: Number(project.tax_rate ?? 0),
    deposit_percent: Number(project.deposit_percent ?? 0),
    lines: rows.map((r) => ({
      ar_key: r.ar_key ?? null,
      description: r.description,
      note: r.note ?? null,
      quantity: Number(r.quantity),
      unit: r.unit ?? "each",
      unit_price: Number(r.unit_price),
      labor_unit_price: Number(r.labor_unit_price ?? 0),
      taxable: r.taxable === true,
      source: r.source === "ar" ? "ar" : "manual",
      price_overridden: r.price_overridden === true,
      labor_overridden: r.labor_overridden === true,
      sort_order: Number(r.sort_order ?? 0),
    })),
  });
}
