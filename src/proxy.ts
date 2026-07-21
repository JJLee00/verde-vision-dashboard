import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Before Supabase env vars are configured, let requests through so the
  // deployment still renders instead of crashing.
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginPage = request.nextUrl.pathname.startsWith("/login");
  // Auth callback exchanges the email-link code for a session — must run
  // with its ?code intact, before any session exists, so never redirect it.
  const isAuthRoute = request.nextUrl.pathname.startsWith("/auth");
  // API routes handle their own auth (e.g. the Vision Pro ingest key).
  const isApiRoute = request.nextUrl.pathname.startsWith("/api");
  // Public living-blueprint links — the unguessable token IS the auth.
  const isShareLink = request.nextUrl.pathname.startsWith("/share/");
  // Dev-only sample scenes (the pages 404 these ids in production).
  const isViewerFixture =
    process.env.NODE_ENV === "development" &&
    (request.nextUrl.pathname === "/viewer/fixture" ||
      request.nextUrl.pathname === "/dashboard/projects/fixture");

  if (
    !user &&
    !isLoginPage &&
    !isAuthRoute &&
    !isApiRoute &&
    !isShareLink &&
    !isViewerFixture
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
