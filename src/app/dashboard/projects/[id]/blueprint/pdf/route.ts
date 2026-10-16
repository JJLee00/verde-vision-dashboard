import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serveBlueprint } from "@/lib/blueprint/serve";
import { FIXTURE_PROJECT } from "@/lib/viewer/fixture";

/**
 * The blueprint sheet for one project, drawn from its saved design.
 *
 * GET /dashboard/projects/{id}/blueprint/pdf
 *   ?download=1   attachment rather than inline
 *
 * Rendered on demand, like the estimate: the design is the source of truth,
 * so a stored PDF could only ever be a stale copy of it. RLS decides who may
 * read the row, exactly as it does for the project page.
 */

// pdfkit is a Node library (fs, streams, font files) — it cannot run on edge.
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const download = request.nextUrl.searchParams.get("download") === "1";
  const supabase = await createClient();

  if (id === "fixture" && process.env.NODE_ENV === "development") {
    return serveBlueprint(
      supabase,
      {
        name: FIXTURE_PROJECT.projectName,
        project_date: null,
        created_at: FIXTURE_PROJECT.createdDate ?? new Date().toISOString(),
        blueprint_path: null,
        project_json: FIXTURE_PROJECT,
        customer_name: null,
      },
      download
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  // Split the same way the project page reads them: the design and the
  // customer came in later migrations, and either missing must not stop the
  // stored PDF from being served.
  const [baseRes, designRes, customerRes] = await Promise.all([
    supabase
      .from("projects")
      .select("name, project_date, created_at, blueprint_path")
      .eq("id", id)
      .single(),
    supabase.from("projects").select("project_json").eq("id", id).single(),
    supabase.from("projects").select("customer_name").eq("id", id).single(),
  ]);
  if (baseRes.error || !baseRes.data) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  return serveBlueprint(
    supabase,
    {
      ...baseRes.data,
      project_json: designRes.data?.project_json ?? null,
      customer_name:
        (customerRes.data as { customer_name?: string | null } | null)?.customer_name ?? null,
    },
    download
  );
}
