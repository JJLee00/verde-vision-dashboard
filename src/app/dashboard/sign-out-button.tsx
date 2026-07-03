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
      className="flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium text-muted transition hover:bg-card-hover hover:text-ink"
    >
      <svg
        className="h-[18px] w-[18px] shrink-0 text-faint"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M13 12H3m0 0 4-4m-4 4 4 4" />
        <path d="M10 4.5V4a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 20 4v16a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 10 20v-.5" />
      </svg>
      Sign out
    </button>
  );
}
