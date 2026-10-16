import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderBlueprintPDF } from "@/lib/pdf/blueprint-pdf";
import type { ProjectFileJSON } from "@/lib/viewer/types";

// One answer for every blueprint link — the project page, the cards, the
// viewer and the share link: the sheet drawn now from the saved design.
//
// A project with no design on the dashboard (synced before project_json
// existed, and not since) still has the PDF its headset uploaded; that is
// handed out through a short-lived signed URL, as before.

export type BlueprintRow = {
  name: string;
  project_date: string | null;
  created_at: string;
  blueprint_path: string | null;
  project_json: unknown;
  customer_name?: string | null;
};

const SIGNED_URL_TTL_SECONDS = 60;

export async function serveBlueprint(
  supabase: SupabaseClient,
  row: BlueprintRow | null,
  download = false,
): Promise<Response> {
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const design = row.project_json as ProjectFileJSON | null;
  if (design) {
    const dated = design.createdDate ?? row.project_date ?? row.created_at;
    const pdf = await renderBlueprintPDF(design, {
      name: row.name,
      date: dated ? new Date(dated) : null,
      client: row.customer_name ?? null,
      designer: null,
    });
    if (pdf) {
      const safeName = row.name.replace(/[^\w\s-]/g, "").trim() || "blueprint";
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName} blueprint.pdf"`,
          // The design can change at any moment; never let a proxy hold one.
          "Cache-Control": "no-store",
        },
      });
    }
  }

  if (row.blueprint_path) {
    const { data, error } = await supabase.storage
      .from("blueprints")
      .createSignedUrl(row.blueprint_path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: error?.message ?? "Could not sign document URL" }, { status: 500 });
    }
    return NextResponse.redirect(data.signedUrl, 302);
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
