"use client";

// Owner-only: narrow the grouped dashboard to one designer's projects.
// Same URL-param pattern as StatusFilter.

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export function DesignerFilter({
  options,
}: {
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("designer", value);
    } else {
      params.delete("designer");
    }
    startTransition(() => {
      router.replace(`/dashboard${params.size ? `?${params}` : ""}`, {
        scroll: false,
      });
    });
  }

  return (
    <div className="relative">
      <select
        value={searchParams.get("designer") ?? ""}
        onChange={(e) => handleChange(e.target.value)}
        aria-label="Filter projects by designer"
        className="w-full appearance-none rounded-lg border border-edge bg-card py-2.5 pl-3.5 pr-9 text-sm text-body outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
      >
        <option value="">All designers</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}
