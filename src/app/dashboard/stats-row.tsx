"use client";

import { useState } from "react";
import Link from "next/link";
import {
  MODES,
  ModeDonut,
  formatDuration,
  R,
  STROKE,
  GAP_PX,
  arcPath,
} from "./projects/[id]/mode-donut";

// The dashboard's stat row: four clickable tiles, each opening a
// drill-down band below the row (one at a time). Glance gives the
// number; click gives the why. Deliberately no hover-expand — layout
// must never shift under the cursor, and touch devices have no hover.
//
// Metrics: Open pipeline ($ pending — the follow-up number), Won
// ($ approved+installed), Close rate (won / quoted), Avg on-site time.
// The first three only get meaningful as project statuses are kept
// current; that's by design.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export type ProjectLite = {
  id: string;
  name: string;
  estimate: number | null;
  createdAt: string | null;
  status: string;
};

type Panel = "pipeline" | "won" | "close" | "time";

function daysAgo(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

const sum = (list: ProjectLite[]) =>
  list.reduce((s, p) => s + (p.estimate ?? 0), 0);

export function StatsRow({
  pending,
  won,
  declinedCount,
  time,
}: {
  pending: ProjectLite[]; // oldest first — follow-up order
  won: ProjectLite[]; // newest first
  declinedCount: number;
  time: { modeSeconds: Record<string, number>; projectCount: number };
}) {
  const [open, setOpen] = useState<Panel | null>(null);
  const toggle = (p: Panel) => setOpen((prev) => (prev === p ? null : p));

  const timeTotal = Object.values(time.modeSeconds).reduce((s, v) => s + v, 0);
  // Close rate counts only decided projects — won vs declined. Pending
  // stays out of the denominator; it's the pipeline, not a loss yet.
  const decidedCount = won.length + declinedCount;
  const closeRate =
    decidedCount > 0 ? Math.round((won.length / decidedCount) * 100) : null;

  return (
    <div className="mt-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TileShell
          panel="pipeline"
          open={open}
          onToggle={toggle}
          label="Open pipeline"
          value={currency.format(sum(pending))}
          caption={`${pending.length} awaiting approval`}
        />
        <TileShell
          panel="won"
          open={open}
          onToggle={toggle}
          label="Won"
          value={currency.format(sum(won))}
          caption={`${won.length} approved or installed`}
        />
        <TileShell
          panel="close"
          open={open}
          onToggle={toggle}
          label="Close rate"
          value={closeRate === null ? "—" : `${closeRate}%`}
          caption={
            decidedCount > 0
              ? `${won.length} of ${decidedCount} decided`
              : "no decisions yet"
          }
        />
        <TileShell
          panel="time"
          open={open}
          onToggle={toggle}
          label="Avg on-site time"
          value={
            time.projectCount > 0
              ? formatDuration(timeTotal / time.projectCount)
              : "—"
          }
          caption={
            time.projectCount > 0
              ? `${time.projectCount} project${time.projectCount === 1 ? "" : "s"} · ${formatDuration(timeTotal)} total`
              : "no headset time yet"
          }
          extra={<TimeMiniDonut modeSeconds={time.modeSeconds} />}
        />
      </div>

      {open && (
        <div className="mt-3 rounded-[14px] border border-edge bg-card p-5 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
          {open === "pipeline" && (
            <ProjectListPanel
              projects={pending}
              empty="Nothing waiting on a client right now."
              metaRight={(p) => daysAgo(p.createdAt)}
              metaTitle="waiting"
            />
          )}
          {open === "won" && (
            <ProjectListPanel
              projects={won}
              empty="Mark a project Approved (or Installed) on its page and it lands here."
              metaRight={(p) => p.status}
              metaTitle="status"
            />
          )}
          {open === "close" && (
            <ClosePanel won={won.length} declined={declinedCount} />
          )}
          {open === "time" && (
            <div className="mx-auto max-w-sm">
              <ModeDonut modeSeconds={time.modeSeconds} />
              {time.projectCount > 0 && (
                <p className="mt-3 text-center text-[11px] text-faint">
                  Average {formatDuration(timeTotal / time.projectCount)} per
                  project across {time.projectCount} synced project
                  {time.projectCount === 1 ? "" : "s"}.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TileShell({
  panel,
  open,
  onToggle,
  label,
  value,
  caption,
  extra,
}: {
  panel: Panel;
  open: Panel | null;
  onToggle: (p: Panel) => void;
  label: string;
  value: string;
  caption: string;
  extra?: React.ReactNode;
}) {
  const active = open === panel;
  return (
    <button
      type="button"
      onClick={() => onToggle(panel)}
      aria-expanded={active}
      className={`rounded-[14px] border bg-card p-5 text-left shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)] transition hover:bg-card-hover ${
        active ? "border-accent/50 ring-1 ring-accent/30" : "border-edge"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
              {label}
            </span>
            <span
              aria-hidden
              className={`text-[10px] text-faint transition-transform ${active ? "rotate-180" : ""}`}
            >
              ▾
            </span>
          </p>
          <p className="mt-1.5 flex min-w-0 items-baseline gap-2 font-serif text-3xl text-ink">
            <span className="shrink-0">{value}</span>
            <span className="truncate font-sans text-[11px] text-faint">
              {caption}
            </span>
          </p>
        </div>
        {extra}
      </div>
    </button>
  );
}

function ProjectListPanel({
  projects,
  empty,
  metaRight,
  metaTitle,
}: {
  projects: ProjectLite[];
  empty: string;
  metaRight: (p: ProjectLite) => string;
  metaTitle: string;
}) {
  if (projects.length === 0) {
    return <p className="text-sm text-muted">{empty}</p>;
  }
  const shown = projects.slice(0, 8);
  return (
    <div className="flex flex-col">
      {shown.map((p) => (
        <Link
          key={p.id}
          href={`/dashboard/projects/${p.id}`}
          className="flex items-baseline gap-3 rounded-md px-2 py-1.5 transition hover:bg-ink/[0.04]"
        >
          <span className="min-w-0 flex-1 truncate text-sm text-body">
            {p.name}
          </span>
          <span className="shrink-0 text-[11px] text-faint" title={metaTitle}>
            {metaRight(p)}
          </span>
          <span className="w-20 shrink-0 text-right font-mono text-sm tabular-nums text-ink">
            {p.estimate != null ? currency.format(p.estimate) : "—"}
          </span>
        </Link>
      ))}
      {projects.length > shown.length && (
        <p className="mt-1 px-2 text-[11px] text-faint">
          and {projects.length - shown.length} more in the list below
        </p>
      )}
    </div>
  );
}

function ClosePanel({ won, declined }: { won: number; declined: number }) {
  const decided = won + declined;
  if (decided === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing decided yet — close rate starts once a project is marked
        Approved, Installed, or Declined.
      </p>
    );
  }
  const pctNum = Math.round((won / decided) * 100);
  return (
    <div className="mx-auto max-w-md">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-body">
          {won} won · {declined} declined
        </span>
        <span className="font-mono font-semibold tabular-nums text-ink">
          {pctNum}%
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${pctNum}%` }}
        />
      </div>
      <p className="mt-3 text-[11px] text-faint">
        Won ÷ decided (won + declined). Pending projects count toward the
        pipeline, not here — mark lost deals Declined so this stays honest.
      </p>
    </div>
  );
}

// Mini donut for the time tile — paints taller than its layout slot
// (negative margins + tight viewBox) so the tile stays the same height
// as the plain tiles. Non-interactive: the drill-down band carries the
// full donut with legend and hover.
function TimeMiniDonut({
  modeSeconds,
}: {
  modeSeconds: Record<string, number>;
}) {
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
  // Same hairline-slice guard as ModeDonut: never let the gap exceed
  // half the slice, or the arc sweeps negative and wraps.
  const inset = (sweep: number) => Math.min(gapAngle / 2, sweep / 4);

  return (
    <svg
      viewBox="7.5 7.5 105 105"
      className="-my-[7px] h-[72px] w-[72px] shrink-0 overflow-visible"
      aria-hidden
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
          const props = {
            fill: "none",
            stroke: s.color,
            strokeWidth: STROKE,
          };
          return slices.length === 1 ? (
            <circle key={s.key} cx={60} cy={60} r={R} {...props} />
          ) : (
            <path
              key={s.key}
              d={arcPath(
                s.start + inset(s.sweep),
                s.start + s.sweep - inset(s.sweep)
              )}
              {...props}
            />
          );
        })
      )}
    </svg>
  );
}
