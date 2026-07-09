"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  {
    href: "/dashboard",
    label: "Dashboard",
    exact: true,
    icon: (
      <path d="M3 10.5 12 3l9 7.5M5.5 8.5V21h5v-6h3v6h5V8.5" />
    ),
  },
  {
    href: "/dashboard/plants",
    label: "Plant Library",
    icon: (
      <path d="M5 21c0-8.5 3.5-14.5 14-16-.5 10.5-6.5 14.5-14 16Zm0 0c2.5-6 6-10 11-12.5" />
    ),
  },
  {
    href: "/dashboard/prices",
    label: "Plant Prices",
    icon: (
      <>
        <path d="M12 2v20M17 5.5H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H7" />
      </>
    ),
  },
  {
    href: "/dashboard/hardscape-prices",
    label: "Hardscape Prices",
    icon: (
      <>
        <path d="M8 20H3.5l3-8.5L11 5l4.5 4L19 8l2.5 12H8Z" />
        <path d="M11 5l1.5 5.5L15.5 9" />
      </>
    ),
  },
  {
    href: "/dashboard/account",
    label: "Account",
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 21c1.4-3.8 4.3-6 7.5-6s6.1 2.2 7.5 6" />
      </>
    ),
  },
  {
    href: "/dashboard/help",
    label: "Help",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.6 9.2a2.6 2.6 0 1 1 3.6 2.4c-.9.4-1.4 1-1.4 1.9v.5" />
        <path d="M12 17.2v.1" />
      </>
    ),
  },
];

export function DashboardNav({ horizontal = false }: { horizontal?: boolean }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Dashboard">
      <ul className={horizontal ? "flex gap-1" : "space-y-1"}>
        {items.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-accent-soft text-ink"
                    : "text-muted hover:bg-card-hover hover:text-ink"
                } ${horizontal ? "whitespace-nowrap px-3 py-2" : ""}`}
              >
                <svg
                  className={`h-[18px] w-[18px] shrink-0 ${
                    active ? "text-accent-dim" : "text-faint"
                  }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {item.icon}
                </svg>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
