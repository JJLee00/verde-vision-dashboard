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

// Fourth stat tile: where the org's headset hours went, summed across
// the same project set as the other tiles (period + designer scoped).
// Mini donut, no legend — the project-page donut teaches the colors,
// and hovering a slice spells it out in the caption line.

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

  const caption = hoveredRow
    ? `${hoveredRow.label} · ${formatDuration(hoveredRow.seconds)} · ${pct(hoveredRow)}`
    : total > 0
      ? `${projectCount} project${projectCount === 1 ? "" : "s"} · ${formatDuration(total)} total`
      : "no headset time synced yet";

  const summary =
    total > 0
      ? rows
          .map((r) => `${r.label} ${formatDuration(r.seconds)} (${pct(r)})`)
          .join(", ")
      : "none recorded yet";

  return (
    <div className="rounded-[14px] border border-edge bg-card p-5 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
        Avg on-site time
      </p>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-serif text-3xl text-ink">
            {total > 0 ? formatDuration(average) : "—"}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-faint">{caption}</p>
        </div>
        <svg
          viewBox="0 0 120 120"
          className="h-24 w-24 shrink-0"
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
