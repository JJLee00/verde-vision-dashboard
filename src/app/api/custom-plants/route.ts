import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Placeholder-plant feed for the Verde Vision Pro app.
 *
 * GET /api/custom-plants?email=<designer email>
 * Header: x-api-key: <VISION_PRO_API_KEY>
 *
 * Returns the designer's ORG's placeholder plants — species the 3D library
 * has no scan of, which the headset draws as schematic stand-ins. Scoped to
 * the org rather than the user so a designer sees placeholders their
 * teammates added, matching how projects and the price book already work
 * (migration 007).
 *
 * Tolerates migration 014 not having been run: responds with an empty list
 * rather than an error, so an app build that knows about placeholders still
 * works against a database that doesn't.
 */

// Missing table: Postgres 42P01 / PostgREST PGRST205.
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

// Mirrors migration 014's CHECK constraint and PlaceholderSymbol in the
// app — reject an unknown symbol here rather than let the DB 500.
const SYMBOLS = new Set([
  "tree", "palm", "shrub", "groundcover",
  "saguaro", "columnar", "rosette", "barrel",
]);

// Same normalisation as scripts/gen-catalog.mjs and the app's
// InventoryStore.normalizePriceKey, so keys line up across all three.
function plantKey(name: string): string {
  return (name.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(" ");
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.VISION_PRO_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = request.nextUrl.searchParams.get("email")?.toLowerCase();
  if (!email) {
    return NextResponse.json(
      { error: "email query parameter is required" },
      { status: 400 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: usersPage, error: usersError } =
    await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }
  const user = usersPage.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) {
    return NextResponse.json(
      { error: `No account found for ${email}` },
      { status: 404 }
    );
  }

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .maybeSingle();

  // Pre-migration-007 accounts have no org row; fall back to their own
  // placeholders so they still get something rather than an error.
  const query = supabase
    .from("custom_plants")
    .select(
      "id, name, botanical_name, key, symbol, mature_height_ft, mature_width_ft, sizes, notes, status, updated_at"
    )
    .order("name");

  const { data: rows, error } = membership?.org_id
    ? await query.eq("org_id", membership.org_id)
    : await query.eq("user_id", user.id);

  if (error) {
    if (MISSING_TABLE.has(error.code ?? "")) {
      return NextResponse.json({ items: [], setupRequired: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: rows ?? [] });
}

/**
 * POST /api/custom-plants
 * Header: x-api-key: <VISION_PRO_API_KEY>
 * Body: { email, name, symbol, mature_height_ft, mature_width_ft,
 *         sizes: [{ size, price, installedHeightFt }], status }
 *
 * Creates a placeholder the designer added in-headset. Upserts on
 * (org_id, key) — the app already refuses a name that collides with
 * something in its catalog, but two headsets can still race, and the app
 * treats a failure here as non-fatal, so a retry must not error.
 */
export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.VISION_PRO_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const email = String(body.email ?? "").toLowerCase();
  const name = String(body.name ?? "").trim();
  const symbol = String(body.symbol ?? "");
  if (!email || !name || !symbol) {
    return NextResponse.json(
      { error: "email, name and symbol are required" },
      { status: 400 }
    );
  }
  if (!SYMBOLS.has(symbol)) {
    return NextResponse.json(
      { error: `Unknown symbol "${symbol}"` },
      { status: 400 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: usersPage, error: usersError } =
    await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }
  const user = usersPage.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) {
    return NextResponse.json(
      { error: `No account found for ${email}` },
      { status: 404 }
    );
  }

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .maybeSingle();

  // Drop sizes the app couldn't price — a draft carries its size with a
  // null price so the dashboard can show what still needs a number.
  const sizes = Array.isArray(body.sizes) ? body.sizes : [];

  const { error } = await supabase
    .from("custom_plants")
    .upsert(
      {
        org_id: membership?.org_id ?? null,
        user_id: user.id,
        name,
        botanical_name: body.botanical_name ?? null,
        key: plantKey(name),
        symbol,
        mature_height_ft: body.mature_height_ft ?? null,
        mature_width_ft: body.mature_width_ft ?? null,
        sizes,
        notes: body.notes ?? null,
        status: body.status === "draft" ? "draft" : "ready",
      },
      { onConflict: "org_id,key" }
    );

  if (error) {
    if (MISSING_TABLE.has(error.code ?? "")) {
      return NextResponse.json(
        { error: "Placeholder plants need migration 014" },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
