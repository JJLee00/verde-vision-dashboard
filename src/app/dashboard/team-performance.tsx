import Link from "next/link";
import { formatDuration } from "./format";

// Owner-only snapshot of how each designer is performing, side by side.
// The firm-wide numbers already live in StatsRow at the top of the
// dashboard; this table breaks that same period down per designer so the
// master can compare the team at a glance. Server-rendered and read-only;
// each designer row links into their filtered dashboard (?designer=).

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export type TeamRow = {
  key: string; // user_id, or "former" for the ex-members bucket
  designerId: string | null; // href target; null = not drillable (former)
  name: string;
  isOwner: boolean;
  projectCount: number;
  pipeline: number; // $ pending
  won: number; // $ approved + installed
  closeRate: number | null; // won / (won + declined), percent
  onSiteSeconds: number;
};

function money(n: number) {
  return n > 0 ? currency.format(n) : "—";
}

function Cells({ row }: { row: TeamRow }) {
  return (
    <>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-sm tabular-nums text-body">
        {row.projectCount}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-sm tabular-nums text-body">
        {money(row.pipeline)}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-sm tabular-nums text-ink">
        {money(row.won)}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-sm tabular-nums text-body">
        {row.closeRate === null ? "—" : `${row.closeRate}%`}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-sm tabular-nums text-body">
        {row.onSiteSeconds > 0 ? formatDuration(row.onSiteSeconds) : "—"}
      </td>
    </>
  );
}

export function TeamPerformance({
  rows,
  total,
  activeDesigner,
}: {
  rows: TeamRow[];
  total: TeamRow;
  activeDesigner: string | null;
}) {
  return (
    <section className="mt-8">
      <h2 className="font-serif text-2xl text-ink">Team performance</h2>
      <div className="mt-4 overflow-x-auto rounded-[14px] border border-edge bg-card shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
        <table className="w-full min-w-[36rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-rule">
              <th className="px-4 py-2.5 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
                Designer
              </th>
              {["Projects", "Pipeline", "Won", "Close rate", "On-site"].map(
                (h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-3 py-2.5 text-right text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const active =
                row.designerId != null && row.designerId === activeDesigner;
              const name = (
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">
                    {row.name}
                  </span>
                  {row.isOwner && (
                    <span className="shrink-0 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-accent-dim">
                      Owner
                    </span>
                  )}
                </span>
              );
              return (
                <tr
                  key={row.key}
                  className={`border-b border-rule/70 last:border-0 transition ${
                    active ? "bg-accent-soft/60" : "hover:bg-ink/[0.03]"
                  }`}
                >
                  <td className="px-4 py-2.5">
                    {row.designerId ? (
                      <Link
                        href={`/dashboard?designer=${row.designerId}`}
                        className="inline-block max-w-full transition hover:text-accent-dim"
                      >
                        {name}
                      </Link>
                    ) : (
                      <span className="text-muted">{name}</span>
                    )}
                  </td>
                  <Cells row={row} />
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-rule-strong bg-ink/[0.03]">
              <td className="px-4 py-2.5 text-sm font-semibold text-ink">
                Firm total
              </td>
              <Cells row={total} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
