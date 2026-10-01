import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// The blueprint behind a share link. (This took a `kind` until Sep 30,
// when the estimate stopped being served here — the only correct proposal
// is the one the dashboard renders from the estimate rows, and that is a
// document the designer sends rather than a button on a client page.)
// Each route validates the token exactly like the share page, then mints
// a short-lived signed URL and redirects — so the links a homeowner keeps
// (or forwards) never go stale, and the storage bucket stays private.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SIGNED_URL_TTL_SECONDS = 60;

export async function redirectToDocument(token: string) {
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = createAdminClient();
  const { data: project } = await supabase
    .from("projects")
    .select("blueprint_path")
    .or(`share_token.eq.${token},crew_token.eq.${token}`)
    // Matches the share page: a deleted project hands out no documents.
    .is("deleted_at", null)
    .maybeSingle();

  const path = project?.blueprint_path;

  if (!path) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: signed, error } = await supabase.storage
    .from("blueprints")
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !signed?.signedUrl) {
    return NextResponse.json(
      { error: error?.message ?? "Could not sign document URL" },
      { status: 500 }
    );
  }

  return NextResponse.redirect(signed.signedUrl, 302);
}
