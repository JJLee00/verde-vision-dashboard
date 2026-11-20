import Link from "next/link";
import { LivingBlueprint } from "@/lib/viewer/LivingBlueprint";
import type { ProjectFileJSON } from "@/lib/viewer/types";
import { boundaryOutline, mainHouse, outlineOf, polygonArea, SQ_FT_PER_SQ_M, type SitePlan } from "@/lib/site-plan/plan";

/**
 * The top of the project page: the design in 3D, whether the headset has
 * synced it or it lives only in the site plan, with a badge for whether
 * it has been lined up with the yard yet, the plan's facts, and the way
 * into the designer. No hooks, so it renders on the server with the rest
 * of the page (the 3D canvas is its own client component).
 */
export function DesignCard({
  projectId,
  projectName,
  design,
  aligned,
  plan,
  placed,
  savedAt,
  ready,
  editsHere,
  disabled,
}: {
  projectId: string;
  projectName: string;
  /** What the 3D view draws: the headset's design, or the site plan's. */
  design: ProjectFileJSON | null;
  /** True once the design sits in the yard's own frame — drawn on the
   *  headset, or carried there by the corner walk. */
  aligned: boolean;
  plan: SitePlan | null;
  /** When the corner walk placed the plan, if it has been. */
  placed: string | null;
  savedAt: string | null;
  /** False until migration-020 has been run. */
  ready: boolean;
  /** Whether the designer can change this design — false for a design
   *  made on the headset without a site plan, which changes in the 3D
   *  viewer instead. */
  editsHere: boolean;
  disabled: boolean;
}) {
  const designer = `/dashboard/projects/${projectId}/site-plan`;
  const viewer = `/viewer/${projectId}`;
  const main = editsHere || !design ? designer : viewer;
  const mainLabel = main === viewer ? "Open 3D viewer" : disabled ? "View design" : "Open designer";

  const house = plan ? mainHouse(plan) : null;
  const houseArea = house ? polygonArea(outlineOf(house)) : 0;
  const lotArea = plan && plan.boundary.length >= 3 ? polygonArea(boundaryOutline(plan)) : 0;
  const sqft = (m2: number) => `${Math.round(m2 * SQ_FT_PER_SQ_M).toLocaleString("en-US")} sq ft`;
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Phoenix" });
  const facts = [
    plan?.lookupAddress,
    houseArea > 0 && `House ${sqft(houseArea)}`,
    lotArea > 0 && `Lot ${sqft(lotArea)}`,
    placed ? `Placed on site ${date(placed)}` : !aligned && savedAt ? `Saved ${date(savedAt)}` : null,
  ].filter((f): f is string => Boolean(f));

  return (
    <div className="overflow-hidden rounded-[14px] border border-edge bg-card shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
      {design ? (
        <Link href={main} className="group relative block h-[380px] bg-[#ebe0cb]" aria-label={mainLabel}>
          <LivingBlueprint project={design} projectName={projectName} showPrices={false} embed />
          <AlignedBadge aligned={aligned} />
          <span className="absolute right-3.5 top-3 rounded-lg border border-rule-strong bg-card/80 px-3 py-1.5 text-[13px] font-semibold text-ink backdrop-blur transition group-hover:bg-card">
            {mainLabel} ⤢
          </span>
        </Link>
      ) : (
        <div className="flex h-[240px] flex-col items-center justify-center gap-2 bg-[#ebe0cb] px-6 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">No design yet</p>
          <p className="max-w-md text-sm text-muted">
            {!ready
              ? "Run migration-020 in Supabase and site plans can be drawn here."
              : disabled
                ? "Nothing has been drawn for this project yet."
                : "Trace the house and the lot over the satellite photo, then design on it — the 3D view appears here as you go. On site, the headset’s corner walk lines it all up with the yard."}
          </p>
          {ready && !disabled && (
            <Link
              href={designer}
              className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-bright"
            >
              Start the site plan
            </Link>
          )}
        </div>
      )}
      {design && (
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-edge px-5 py-3">
          <p className="flex min-w-0 flex-wrap gap-x-2 text-sm text-muted">
            {facts.map((f, i) => (
              <span key={f} className={i === 0 ? "text-body" : ""}>
                {i > 0 && "· "}
                {f}
              </span>
            ))}
          </p>
          <div className="flex items-center gap-4 text-sm font-semibold">
            {ready && (
              <Link href={designer} className="text-accent transition hover:text-accent-bright">
                {plan || editsHere ? "Designer →" : "Trace a site plan →"}
              </Link>
            )}
            {aligned && (
              <Link href={viewer} className="text-accent transition hover:text-accent-bright">
                3D viewer →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Lined up with the yard, or only drawn over the photo so far. */
export function AlignedBadge({ aligned, className = "absolute left-3.5 top-3" }: { aligned: boolean; className?: string }) {
  return (
    <span
      className={`${className} inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur ${
        aligned ? "border-accent/40 bg-accent-soft/80 text-accent-dim" : "border-gold/50 bg-[#f6ecd6]/90 text-gold"
      }`}
      title={
        aligned
          ? "This design sits in the yard's own frame — the headset puts it where it was designed."
          : "Drawn over the satellite photo. The headset's corner walk lines it up with the yard on the first visit."
      }
    >
      <span className={`h-1.5 w-1.5 rounded-full ${aligned ? "bg-accent" : "bg-gold"}`} />
      {aligned ? "Aligned to property" : "Not aligned to property yet"}
    </span>
  );
}
