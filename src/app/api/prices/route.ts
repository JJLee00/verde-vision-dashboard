import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Prices feed for the Verde Vision Pro app.
 *
 * GET /api/prices?email=<designer email>
 * Header: x-api-key: <VISION_PRO_API_KEY>
 *
 * Returns the designer's manual prices and (signed, 1h) links to their
 * uploaded price sheets so the app can price estimates with the designer's
 * own numbers instead of the built-in catalog.
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

  const [{ data: items, error: itemsError }, { data: sheets }] =
    await Promise.all([
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
    ]);

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

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
    items: items ?? [],
    sheets: sheetLinks,
  });
}
