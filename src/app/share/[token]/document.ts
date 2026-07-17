import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Shared handler for the public document routes under /share/[token].
// Each route validates the token exactly like the share page, then mints
// a short-lived signed URL and redirects — so the links a homeowner keeps
// (or forwards) never go stale, and the storage bucket stays private.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SIGNED_URL_TTL_SECONDS = 60;

export async function redirectToDocument(
  token: string,
  kind: "blueprint" | "estimate"
) {
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = createAdminClient();
  const { data: project } = await supabase
    .from("projects")
    .select("blueprint_path, estimate_path, share_token")
    .or(`share_token.eq.${token},crew_token.eq.${token}`)
    .maybeSingle();

  // The estimate is all pricing, so it's client-link only — the crew
  // token exists specifically to hide prices from install crews.
  const crewToken = project != null && project.share_token !== token;
  const path =
    kind === "blueprint"
      ? project?.blueprint_path
      : crewToken
        ? null
        : project?.estimate_path;
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
