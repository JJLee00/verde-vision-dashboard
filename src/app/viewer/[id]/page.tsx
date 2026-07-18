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
        documents={{ blueprint: "#", estimate: "#" }}
      />
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Both project rows and the price sheet are independent — fire them
  // together so the viewer isn't waiting on a chain of round-trips. The
  // migration-008 columns are fetched in their own select() so the page
  // still renders before that migration has been run.
  const [baseRes, extraRes, priceRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, estimate_amount, blueprint_path, estimate_path")
      .eq("id", id)
      .single(),
    supabase
      .from("projects")
      .select("project_json")
      .eq("id", id)
      .single(),
    supabase.from("price_items").select("name, price, category").eq("category", "plant"),
  ]);

  const project = baseRes.data;
  if (baseRes.error || !project) notFound();

  let projectJson: ProjectFileJSON | null = null;
  if (extraRes.data) {
    projectJson = (extraRes.data.project_json as ProjectFileJSON | null) ?? null;
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
  // Already fetched alongside the project rows above.
  const priceOverrides: Record<string, number> = {};
  for (const row of priceRes.data ?? []) {
    priceOverrides[row.name.toLowerCase()] = Number(row.price);
  }

  // Same PDF buttons the share page offers, so designers see exactly what
  // clients get. Signed for an hour, like the project page's document links.
  const docPaths = [project.blueprint_path, project.estimate_path].filter(
    (p): p is string => Boolean(p)
  );
  let documents: { blueprint: string | null; estimate: string | null } | null =
    null;
  if (docPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("blueprints")
      .createSignedUrls(docPaths, 60 * 60);
    const byPath = new Map(
      (signed ?? [])
        .filter((s) => s.signedUrl)
        .map((s) => [s.path, s.signedUrl])
    );
    documents = {
      blueprint: project.blueprint_path
        ? (byPath.get(project.blueprint_path) ?? null)
        : null,
      estimate: project.estimate_path
        ? (byPath.get(project.estimate_path) ?? null)
        : null,
    };
  }

  return (
    <LivingBlueprint
      project={projectJson}
      projectName={project.name}
      estimateAmount={project.estimate_amount}
      priceOverrides={priceOverrides}
      showPrices
      backHref="/dashboard"
      documents={documents}
    />
  );
}
