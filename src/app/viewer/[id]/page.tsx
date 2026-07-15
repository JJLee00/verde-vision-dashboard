import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LivingBlueprint } from "@/lib/viewer/LivingBlueprint";
import type { ProjectFileJSON } from "@/lib/viewer/types";
import { FIXTURE_PROJECT } from "@/lib/viewer/fixture";

// Full-screen living-blueprint viewer for a signed-in designer.
// Lives outside /dashboard on purpose — no nav chrome, the drawing owns
// the whole screen. Public (client / crew) links render the same
// component via /share/[token].

export const metadata = { title: "3D Plan — Verde Vision" };

export default async function ViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Dev-only sample scene so the viewer can be reviewed without real
  // headset data (and without touching the shared database).
  if (id === "fixture" && process.env.NODE_ENV === "development") {
    return (
      <LivingBlueprint
        project={FIXTURE_PROJECT}
        projectName={FIXTURE_PROJECT.projectName}
        estimateAmount={8460}
        showPrices
        backHref="/dashboard"
        shareTokens={null}
      />
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project, error } = await supabase
    .from("projects")
    .select("id, name, estimate_amount")
    .eq("id", id)
    .single();
  if (error || !project) notFound();

  // Fetched separately and tolerantly so the page still renders (with the
  // sync-nudge empty state) before migration-008 has been run.
  let projectJson: ProjectFileJSON | null = null;
  let shareTokens: { client: string; crew: string } | null = null;
  const { data: extra } = await supabase
    .from("projects")
    .select("project_json, share_token, crew_token")
    .eq("id", id)
    .single();
  if (extra) {
    projectJson = (extra.project_json as ProjectFileJSON | null) ?? null;
    if (extra.share_token && extra.crew_token) {
      shareTokens = { client: extra.share_token, crew: extra.crew_token };
    }
  }

  if (!projectJson) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper px-6 text-center">
        <h1 className="font-serif text-3xl text-ink">{project.name}</h1>
        <p className="max-w-md text-sm leading-relaxed text-muted">
          No 3D plan yet. Export a blueprint or estimate from the Vision Pro
          app and the design will appear here automatically — every save
          from the headset updates this page.
        </p>
        <Link
          href="/dashboard"
          className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-paper transition hover:bg-accent-bright"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  // The designer's own Prices-tab entries override catalog defaults in the
  // material rail (matched by plant name, same as the headset app does).
  const priceOverrides: Record<string, number> = {};
  const { data: priceRows } = await supabase
    .from("price_items")
    .select("name, price, category")
    .eq("category", "plant");
  for (const row of priceRows ?? []) {
    priceOverrides[row.name.toLowerCase()] = Number(row.price);
  }

  return (
    <LivingBlueprint
      project={projectJson}
      projectName={project.name}
      estimateAmount={project.estimate_amount}
      priceOverrides={priceOverrides}
      showPrices
      backHref="/dashboard"
      shareTokens={shareTokens}
    />
  );
}
