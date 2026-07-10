"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

// Time range for the whole dashboard: narrows both the stat cards and the
// project list to projects created within the selected calendar period.
const OPTIONS = [
  { value: "", label: "All time" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
];

export function PeriodFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("period", value);
    } else {
      params.delete("period");
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
        value={searchParams.get("period") ?? ""}
        onChange={(e) => handleChange(e.target.value)}
        aria-label="Filter dashboard by time range"
        className="w-full appearance-none rounded-lg border border-edge bg-card py-2.5 pl-3.5 pr-9 text-sm text-body outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
      >
        {OPTIONS.map((option) => (
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
