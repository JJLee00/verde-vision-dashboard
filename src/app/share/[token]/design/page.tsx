import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { LivingBlueprint } from "@/lib/viewer/LivingBlueprint";
import type { ProjectFileJSON } from "@/lib/viewer/types";

// Public living-blueprint link. Two token flavors per project (see
// migration-008): share_token shows pricing (homeowner link), crew_token
// hides it (install-crew link). Tokens are unguessable uuids, so this
// page uses the service role directly — no sign-in required.

export const metadata = { title: "Landscape plan — Verde Vision" };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!UUID_RE.test(token)) notFound();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, client_id, name, estimate_amount, project_json, share_token, crew_token, blueprint_path, estimate_path"
    )
    .or(`share_token.eq.${token},crew_token.eq.${token}`)
    // A deleted project's link stops working. The row survives so an owner
    // can restore it, but a client or an install crew following an old link
    // must not still be looking at a job that was taken down.
    .is("deleted_at", null)
    .maybeSingle();

  if (!project?.project_json) notFound();

  // No pricing in the viewer, on either token.
  //
  // It used to appear on the client link, which quietly overrode a decision
  // the designer had already made: the estimate has an itemized / lump-sums
  // toggle precisely so they control how much line-by-line detail a client
  // sees, and a viewer that always itemises at list price makes that control
  // a fiction. It was also a third total, computed from catalog prices, free
  // to disagree with the estimate's (which carries manual rows and tax).
  //
  // Prices were the only difference between the client and crew links, so
  // removing them is what collapses the two into one. Both tokens still
  // resolve — links already sent keep working — they simply show the same
  // thing, which is the design. The crew SHOULD see the plan.
  const showPrices = false;

  // Document buttons point at the token routes (which mint a fresh signed
  // URL per click) so a link kept open for days never goes stale. The
  // estimate is pricing, so the crew link never gets it.
  // The estimate is deliberately absent. It used to serve `estimate_path` —
  // the PDF the app uploaded until Sep 30 — which is now either stale
  // (priced off the catalog, no tax, no manual rows) or simply never set.
  // The only correct proposal is the one the dashboard renders from the
  // estimate rows on demand, and that is a document the designer sends.
  const documents = {
    blueprint: project.blueprint_path ? `/share/${token}/blueprint` : null,
    estimate: null,
  };

  const priceOverrides: Record<string, number> = {};

  return (
    <LivingBlueprint
      project={project.project_json as ProjectFileJSON}
      projectName={project.name}
      estimateAmount={showPrices ? project.estimate_amount : null}
      priceOverrides={priceOverrides}
      showPrices={showPrices}
      backHref={`/share/${token}`}
      documents={documents}
    />
  );
}
