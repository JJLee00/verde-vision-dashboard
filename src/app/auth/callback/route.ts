import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Auth redirect target for the password-reset (and any future magic-link)
// flow. Supabase sends the recovery email link here with a PKCE `code`;
// we exchange it for a session cookie, then forward to `next` (the
// set-a-new-password page). This route is exempt from the proxy so the
// code survives instead of being bounced to /login.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  // Only allow same-app relative paths — never an open redirect.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=expired_link`);
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}
