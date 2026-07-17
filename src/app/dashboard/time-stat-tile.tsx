"use client";

import { useState } from "react";
import {
  MODES,
  formatDuration,
  R,
  STROKE,
  GAP_PX,
  arcPath,
} from "./projects/[id]/mode-donut";

// Fourth stat tile: average headset time per tracked project, scoped
// like the other tiles (period + designer). Mini donut, no legend — the
// project-page donut teaches the colors, and hovering a slice swaps the
// tile's own label + number to that mode's time and share.

export function TimeStatTile({
  modeSeconds,
  projectCount,
}: {
  modeSeconds: Record<string, number>;
  projectCount: number;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const rows = MODES.map((m) => ({
    ...m,
    seconds: modeSeconds[m.key] ?? 0,
  })).filter((r) => r.seconds > 0);
  const total = rows.reduce((s, r) => s + r.seconds, 0);

  const gapAngle = GAP_PX / R;
  let cursor = 0;
  const slices = rows.map((r) => {
    const sweep = (r.seconds / total) * Math.PI * 2;
    const start = cursor;
    cursor += sweep;
    return { ...r, start, sweep };
  });

  const hoveredRow = rows.find((r) => r.key === hovered) ?? null;
  const pct = (r: { seconds: number }) =>
    `${Math.round((r.seconds / total) * 100)}%`;

  const average = projectCount > 0 ? total / projectCount : 0;

  const summary =
    total > 0
      ? rows
          .map((r) => `${r.label} ${formatDuration(r.seconds)} (${pct(r)})`)
          .join(", ")
      : "none recorded yet";

  return (
    <div className="rounded-[14px] border border-edge bg-card p-5 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
      {/* Layout height matches the plain StatTiles exactly (label row +
          number row); the donut paints taller than its slot via negative
          margins so it fills the card without stretching the grid row. */}
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
          {hoveredRow ? hoveredRow.label : "Avg on-site time"}
        </p>
        <p className="shrink-0 text-[10px] text-faint">
          {total > 0
            ? `${projectCount} project${projectCount === 1 ? "" : "s"} · ${formatDuration(total)} total`
            : "no headset time yet"}
        </p>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-serif text-3xl text-ink">
          {total > 0
            ? formatDuration(hoveredRow ? hoveredRow.seconds : average)
            : "—"}
          {hoveredRow && (
            <span className="ml-1.5 font-sans text-base font-medium text-muted">
              {pct(hoveredRow)}
            </span>
          )}
        </p>
        <svg
          viewBox="7.5 7.5 105 105"
          className="-my-[18px] h-[72px] w-[72px] shrink-0 overflow-visible"
          role="img"
          aria-label={`On-site time by mode: ${summary}`}
        >
          {total === 0 ? (
            <circle
              cx={60}
              cy={60}
              r={R}
              fill="none"
              stroke="currentColor"
              strokeWidth={STROKE}
              className="text-ink/[0.07]"
            />
          ) : (
            slices.map((s) => {
              const dimmed = hovered !== null && hovered !== s.key;
              const visible = {
                fill: "none",
                stroke: s.color,
                strokeWidth: STROKE,
                opacity: dimmed ? 0.3 : 1,
                pointerEvents: "none" as const,
                style: { transition: "opacity 120ms ease" },
              };
              const hit = {
                fill: "none",
                stroke: "transparent",
                strokeWidth: STROKE * 2.2,
                onMouseEnter: () => setHovered(s.key),
                onMouseLeave: () => setHovered(null),
              };
              const d = arcPath(
                s.start + gapAngle / 2,
                s.start + s.sweep - gapAngle / 2
              );
              return slices.length === 1 ? (
                <g key={s.key}>
                  <circle cx={60} cy={60} r={R} {...visible} />
                  <circle cx={60} cy={60} r={R} {...hit} />
                </g>
              ) : (
                <g key={s.key}>
                  <path d={d} {...visible} />
                  <path d={d} {...hit} />
                </g>
              );
            })
          )}
        </svg>
      </div>
    </div>
  );
}
