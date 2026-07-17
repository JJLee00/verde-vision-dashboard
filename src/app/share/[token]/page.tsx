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
    .maybeSingle();

  if (!project?.project_json) notFound();

  const showPrices = project.share_token === token;

  // Document buttons point at the token routes (which mint a fresh signed
  // URL per click) so a link kept open for days never goes stale. The
  // estimate is pricing, so the crew link never gets it.
  const documents = {
    blueprint: project.blueprint_path ? `/share/${token}/blueprint` : null,
    estimate:
      showPrices && project.estimate_path ? `/share/${token}/estimate` : null,
  };

  const priceOverrides: Record<string, number> = {};
  if (showPrices) {
    const { data: priceRows } = await supabase
      .from("price_items")
      .select("name, price")
      .eq("category", "plant")
      .eq("user_id", project.client_id);
    for (const row of priceRows ?? []) {
      priceOverrides[row.name.toLowerCase()] = Number(row.price);
    }
  }

  return (
    <LivingBlueprint
      project={project.project_json as ProjectFileJSON}
      projectName={project.name}
      estimateAmount={showPrices ? project.estimate_amount : null}
      priceOverrides={priceOverrides}
      showPrices={showPrices}
      backHref={null}
      shareTokens={null}
      documents={documents}
    />
  );
}
