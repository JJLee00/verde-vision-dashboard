import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import catalog from "@/lib/catalog.json";

/**
 * Prices feed for the Verde Vision Pro app.
 *
 * GET /api/prices?email=<designer email>
 * Header: x-api-key: <VISION_PRO_API_KEY>
 *
 * Returns the designer's price grid (plantPrices keyed by catalog
 * plant_key + size, laborRates keyed by size), legacy manual items, and
 * (signed, 1h) links to their uploaded price sheets.
 *
 * Compat bridge: plant_prices rows are ALSO emitted in the legacy items[]
 * format ("Aloe Vera 5g", category "plant") so app builds that predate the
 * grid pick them up through their fuzzy name matcher. Emitted after the
 * legacy rows so grid prices win when both name-match.
 */
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

  const [
    { data: items, error: itemsError },
    { data: sheets },
    { data: laborRows },
    { data: priceRows },
  ] = await Promise.all([
    supabase
      .from("price_items")
      .select("name, category, price, unit")
      .eq("user_id", user.id)
      .order("name"),
    supabase
      .from("price_sheets")
      .select("file_name, file_path, row_count")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    // Tolerate missing tables (migration 005 not run yet) — these two
    // queries just come back null and the grid fields are empty.
    supabase.from("labor_rates").select("size, rate").eq("user_id", user.id),
    supabase
      .from("plant_prices")
      .select("plant_key, size, price")
      .eq("user_id", user.id),
  ]);

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  // Legacy bridge: grid rows as name-keyed plant items for older apps.
  const nameByKey = new Map(catalog.plants.map((p) => [p.key, p.name]));
  const bridgeItems = (priceRows ?? []).flatMap((row) => {
    const plantName = nameByKey.get(row.plant_key);
    return plantName
      ? [
          {
            name: `${plantName} ${row.size}`,
            category: "plant",
            price: row.price,
            unit: "each",
          },
        ]
      : [];
  });

  const sheetLinks: Array<{
    file_name: string;
    row_count: number | null;
    url: string;
  }> = [];
  const paths = (sheets ?? []).map((s) => s.file_path);
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage
      .from("price-sheets")
      .createSignedUrls(paths, 60 * 60);
    const byPath = new Map(
      (urls ?? [])
        .filter((u) => u.path && u.signedUrl)
        .map((u) => [u.path as string, u.signedUrl])
    );
    for (const sheet of sheets ?? []) {
      const url = byPath.get(sheet.file_path);
      if (url) {
        sheetLinks.push({
          file_name: sheet.file_name,
          row_count: sheet.row_count,
          url,
        });
      }
    }
  }

  return NextResponse.json({
    email,
    items: [...(items ?? []), ...bridgeItems],
    plantPrices: priceRows ?? [],
    laborRates: laborRows ?? [],
    sheets: sheetLinks,
  });
}
