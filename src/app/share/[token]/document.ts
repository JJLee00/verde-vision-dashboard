import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serveBlueprint } from "@/lib/blueprint/serve";

// The blueprint behind a share link. (This took a `kind` until Sep 30,
// when the estimate stopped being served here — the only correct proposal
// is the one the dashboard renders from the estimate rows, and that is a
// document the designer sends rather than a button on a client page.)
//
// The token is validated exactly like the share page, then the sheet is
// drawn from the saved design, so a link a homeowner keeps always shows the
// current design. A project with no design on the dashboard falls back to
// the PDF its headset uploaded, through a short-lived signed URL, so the
// storage bucket stays private.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function redirectToDocument(token: string) {
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = createAdminClient();
  const { data: project } = await supabase
    .from("projects")
    .select("name, project_date, created_at, blueprint_path, project_json, customer_name")
    .or(`share_token.eq.${token},crew_token.eq.${token}`)
    // Matches the share page: a deleted project hands out no documents.
    .is("deleted_at", null)
    .maybeSingle();

  return serveBlueprint(supabase, project ?? null);
}
