"use client";

import { useState } from "react";

// Donut of headset time per mode — part-to-whole at a glance, exact
// numbers in the legend. Slices keep a fixed order and a fixed color per
// mode (palette validated for CVD separation against the card surface);
// hovering a slice or legend row swaps the center total for that mode.

export const MODES: { key: string; label: string; color: string }[] = [
  { key: "design", label: "Designing", color: "#348055" },
  { key: "blueprint", label: "Blueprint", color: "#4478b3" },
  { key: "clientView", label: "Presenting", color: "#a87b2f" },
  { key: "night", label: "Night preview", color: "#8a5090" },
];

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export const R = 44; // arc centerline radius
export const STROKE = 17;
export const GAP_PX = 2; // surface gap between slices, per mark spec

export function polar(angle: number): [number, number] {
  // 0 = 12 o'clock, clockwise. Coordinates round to 2 decimals so the
  // server- and client-rendered path strings match byte-for-byte —
  // raw Math.cos/sin ULPs differ across JS engines and trip React
  // hydration on the `d` attribute.
  const a = angle - Math.PI / 2;
  const round = (v: number) => Math.round(v * 100) / 100;
  return [round(60 + R * Math.cos(a)), round(60 + R * Math.sin(a))];
}

export function arcPath(start: number, end: number): string {
  const [x0, y0] = polar(start);
  const [x1, y1] = polar(end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M ${x0} ${y0} A ${R} ${R} 0 ${largeArc} 1 ${x1} ${y1}`;
}

export function ModeDonut({
  modeSeconds,
}: {
  modeSeconds: Record<string, number>;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const rows = MODES.map((m) => ({
    ...m,
    seconds: modeSeconds[m.key] ?? 0,
  })).filter((r) => r.seconds > 0);
  const total = rows.reduce((s, r) => s + r.seconds, 0);
  if (total === 0) {
    return (
      <p className="text-sm text-muted">
        Time tracking starts on the next headset session for this project.
      </p>
    );
  }

  // Half the gap comes off each side of a slice; a lone slice is a
  // plain circle (the arc math degenerates at a full 360°).
  const gapAngle = GAP_PX / R;
  let cursor = 0;
  const slices = rows.map((r) => {
    const sweep = (r.seconds / total) * Math.PI * 2;
    const start = cursor;
    cursor += sweep;
    return { ...r, start, sweep };
  });
  // A slice narrower than the gap would get a negative sweep and wrap
  // the arc the wrong way around — cap the inset at a quarter sweep so
  // hairline slices shrink their gap instead.
  const inset = (sweep: number) => Math.min(gapAngle / 2, sweep / 4);

  const hoveredRow = rows.find((r) => r.key === hovered) ?? null;
  const pct = (r: { seconds: number }) =>
    `${Math.round((r.seconds / total) * 100)}%`;

  const summary = rows
    .map((r) => `${r.label} ${formatDuration(r.seconds)} (${pct(r)})`)
    .join(", ");

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        <svg
          viewBox="0 0 120 120"
          className="h-40 w-40"
          role="img"
          aria-label={`Time in each mode: ${summary}`}
        >
          {slices.map((s) => {
            const dimmed = hovered !== null && hovered !== s.key;
            // Visible slice + a fat transparent twin on top so the hover
            // target is ~2x the stroke — no pixel-hunting with the mouse.
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
              s.start + inset(s.sweep),
              s.start + s.sweep - inset(s.sweep)
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
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-faint">
            {hoveredRow ? hoveredRow.label : "On site"}
          </span>
          <span className="font-mono text-lg font-semibold tabular-nums text-ink">
            {formatDuration(hoveredRow ? hoveredRow.seconds : total)}
          </span>
          {hoveredRow && (
            <span className="text-[11px] text-muted">{pct(hoveredRow)}</span>
          )}
        </div>
      </div>

      <div className="flex w-full flex-col">
        {rows.map((r) => (
          <div
            key={r.key}
            onMouseEnter={() => setHovered(r.key)}
            onMouseLeave={() => setHovered(null)}
            className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 transition ${
              hovered === r.key ? "bg-ink/[0.05]" : ""
            }`}
          >
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: r.color }}
            />
            <span className="flex-1 text-sm text-body">{r.label}</span>
            <span className="font-mono text-sm tabular-nums text-ink">
              {formatDuration(r.seconds)}
            </span>
            <span className="w-9 text-right text-[11px] tabular-nums text-faint">
              {pct(r)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
