"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      className="rounded-lg border border-rule-strong bg-card px-4 py-2 text-sm font-medium text-ink transition hover:border-ink/45 hover:bg-card-hover"
    >
      Sign out
    </button>
  );
}
