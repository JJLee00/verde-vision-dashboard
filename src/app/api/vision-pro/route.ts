import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Ingest endpoint for the Verde Vision Pro app.
 *
 * POST multipart/form-data with header `x-api-key: <VISION_PRO_API_KEY>`
 * Fields:
 *   client_email    — email of the client account (required for new projects)
 *   project_id      — existing project to update (optional; omit to create)
 *   name            — project name (required when creating)
 *   project_date    — YYYY-MM-DD (optional)
 *   estimate_amount — number, e.g. 12400.50 (optional)
 *   blueprint       — PDF file (optional)
 */
export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.VISION_PRO_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 }
    );
  }

  const projectId = form.get("project_id")?.toString() || null;
  const clientEmail = form.get("client_email")?.toString().toLowerCase() || null;
  const name = form.get("name")?.toString() || null;
  const projectDate = form.get("project_date")?.toString() || null;
  const estimateRaw = form.get("estimate_amount")?.toString() || null;
  const blueprint = form.get("blueprint");

  const estimateAmount = estimateRaw ? Number(estimateRaw) : null;
  if (estimateRaw && Number.isNaN(estimateAmount)) {
    return NextResponse.json(
      { error: "estimate_amount must be a number" },
      { status: 400 }
    );
  }

  let project: { id: string; client_id: string };

  if (projectId) {
    const { data, error } = await supabase
      .from("projects")
      .select("id, client_id")
      .eq("id", projectId)
      .single();
    if (error || !data) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    project = data;
  } else {
    if (!clientEmail || !name) {
      return NextResponse.json(
        { error: "client_email and name are required to create a project" },
        { status: 400 }
      );
    }

    // Look up the client account by email.
    const { data: usersPage, error: usersError } =
      await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 });
    }
    const client = usersPage.users.find(
      (u) => u.email?.toLowerCase() === clientEmail
    );
    if (!client) {
      return NextResponse.json(
        { error: `No client account found for ${clientEmail}` },
        { status: 404 }
      );
    }

    const { data, error } = await supabase
      .from("projects")
      .insert({ client_id: client.id, name })
      .select("id, client_id")
      .single();
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Could not create project" },
        { status: 500 }
      );
    }
    project = data;
  }

  const updates: Record<string, unknown> = {};
  if (name && projectId) updates.name = name;
  if (projectDate) updates.project_date = projectDate;
  if (estimateAmount != null) updates.estimate_amount = estimateAmount;

  // Upload the blueprint PDF to the private bucket.
  if (blueprint instanceof File && blueprint.size > 0) {
    const path = `${project.client_id}/${project.id}/${Date.now()}-blueprint.pdf`;
    const { error: uploadError } = await supabase.storage
      .from("blueprints")
      .upload(path, blueprint, { contentType: "application/pdf" });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }
    updates.blueprint_path = path;
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from("projects")
      .update(updates)
      .eq("id", project.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, project_id: project.id });
}
