"use client";

import { usePathname } from "next/navigation";

// Pages that take the whole screen, the way the 3D viewer does (it lives
// outside /dashboard entirely). The estimate builder is a wide ruled grid —
// a 40-row bid with Price, Labor and Amount side by side — and the 240px
// menu beside it was space the bid needed. Its own top bar leads back to the
// project.
const FULL_SCREEN = [/^\/dashboard\/projects\/[^/]+\/estimate\/?$/];

/** Renders the dashboard's menu and mobile header everywhere except those. */
export function DashboardChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "";
  return FULL_SCREEN.some((re) => re.test(path)) ? null : <>{children}</>;
}
