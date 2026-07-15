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
 *   status          — pending | approved | installed (optional)
 *   blueprint       — PDF file (optional)
 *   project_json    — full ProjectFile JSON saved by the app (optional);
 *                     drives the living-blueprint 3D viewer. Replaced
 *                     wholesale on every sync.
 */
const VALID_STATUSES = ["pending", "approved", "installed"];
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
  const status = form.get("status")?.toString() || null;
  const blueprint = form.get("blueprint");
  const estimatePdf = form.get("estimate");
  const plantsRaw = form.get("plants")?.toString() || null;
  const projectJsonPart = form.get("project_json");

  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const estimateAmount = estimateRaw ? Number(estimateRaw) : null;
  if (estimateRaw && Number.isNaN(estimateAmount)) {
    return NextResponse.json(
      { error: "estimate_amount must be a number" },
      { status: 400 }
    );
  }

  // Plant usage summary: [{ key: "aloe vera", size: "5g", count: 12 }].
  // Replaces the project's previous summary wholesale on every sync.
  let plantUsage: { key: string; size: string; count: number }[] | null = null;
  if (plantsRaw) {
    try {
      const parsed: unknown = JSON.parse(plantsRaw);
      if (!Array.isArray(parsed) || parsed.length > 500) throw new Error();
      plantUsage = parsed.map((row) => {
        const { key, size, count } = row as Record<string, unknown>;
        if (
          typeof key !== "string" ||
          typeof size !== "string" ||
          typeof count !== "number" ||
          !Number.isFinite(count) ||
          count < 0
        ) {
          throw new Error();
        }
        return { key, size, count: Math.round(count) };
      });
    } catch {
      return NextResponse.json(
        { error: "plants must be a JSON array of {key, size, count}" },
        { status: 400 }
      );
    }
  }

  // Full ProjectFile from the app. Arrives as a file part (the Swift
  // uploader sends it as project.json) but a plain text field also works.
  // Parsed only to validate + strip whitespace; stored as jsonb.
  const PROJECT_JSON_MAX_BYTES = 5 * 1024 * 1024;
  let projectJson: unknown = null;
  if (projectJsonPart) {
    const size =
      projectJsonPart instanceof File ? projectJsonPart.size : projectJsonPart.length;
    if (size > PROJECT_JSON_MAX_BYTES) {
      return NextResponse.json(
        { error: "project_json exceeds 5 MB" },
        { status: 400 }
      );
    }
    const text =
      projectJsonPart instanceof File
        ? await projectJsonPart.text()
        : projectJsonPart.toString();
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error();
      }
      projectJson = parsed;
    } catch {
      return NextResponse.json(
        { error: "project_json must be a JSON object" },
        { status: 400 }
      );
    }
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
  if (status) updates.status = status;
  if (plantUsage) updates.plant_usage = plantUsage;
  if (projectJson) {
    updates.project_json = projectJson;
    updates.project_json_updated_at = new Date().toISOString();
  }

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

  // The itemized estimate PDF lives in the same bucket + folder as the
  // blueprint, so the existing client read policy covers it.
  if (estimatePdf instanceof File && estimatePdf.size > 0) {
    const path = `${project.client_id}/${project.id}/${Date.now()}-estimate.pdf`;
    const { error: uploadError } = await supabase.storage
      .from("blueprints")
      .upload(path, estimatePdf, { contentType: "application/pdf" });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }
    updates.estimate_path = path;
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
