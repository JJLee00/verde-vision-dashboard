import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/org";
import { DesignEditor } from "./design-editor";
import type { ProjectFileJSON } from "@/lib/viewer/types";
import { pricesFromRows } from "@/lib/price-book";
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
      <DesignEditor
        projectId="fixture"
        canEdit
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
      .select("id, name, estimate_amount, blueprint_path, estimate_path, client_id")
      .eq("id", id)
      // A deleted project is not editable. Without this the viewer stays
      // reachable by direct link and could publish revisions to a project
      // that no longer appears anywhere — restoring it would then hand back
      // a design nobody meant to keep working on.
      .is("deleted_at", null)
      .single(),
    supabase
      .from("projects")
      .select("project_json")
      .eq("id", id)
      .single(),
    supabase.from("plant_prices").select("plant_key, size, price"),
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

  // The org's Plant Prices / Hardscape Prices grid (RLS scopes the read to
  // the viewer's org, as on the Prices pages). Blank cells are $0 — the same
  // numbers the estimate and the headset use. Fetched alongside the project
  // rows above.
  const priceOverrides = pricesFromRows(priceRes.data);

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

  // Editing is org work: the designer who owns the project, or an owner.
  // Read tolerantly — a pre-016 database has no project_versions table, and
  // the viewer must still open.
  const membership = await getMembership(supabase, user.id);
  const canEdit =
    project.client_id === user.id || membership?.role === "owner";


  return (
    <DesignEditor
      projectId={id}
      canEdit={canEdit}
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
