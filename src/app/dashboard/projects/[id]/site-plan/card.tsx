import Link from "next/link";
import { boundaryOutline, mainHouse, outlineOf, polygonArea, SQ_FT_PER_SQ_M, type SitePlan, type XZ } from "@/lib/site-plan/plan";
import { BoundaryArt, byLayer, FeatureArt, PlanPatterns, SHEET_PAPER, type Pt } from "./drawing";

/**
 * The project page's Site plan card: a small drawing of the plan, its
 * facts, and the way into the builder. No hooks, so it renders on the
 * server with the rest of the page.
 */
export function SitePlanCard({
  projectId,
  plan,
  placed,
  savedAt,
  ready,
  disabled,
}: {
  projectId: string;
  plan: SitePlan | null;
  /** When the corner walk placed it, if it has been. */
  placed: string | null;
  savedAt: string | null;
  /** False until migration-020 has been run. */
  ready: boolean;
  disabled: boolean;
}) {
  if (!ready) {
    return <p className="text-sm text-muted">Run migration-020 in Supabase and site plans can be drawn here.</p>;
  }
  const href = `/dashboard/projects/${projectId}/site-plan`;
  const open = (label: string) => (
    <Link
      href={href}
      className="rounded-lg border border-rule-strong px-4 py-2 text-sm font-semibold text-body transition hover:border-accent hover:text-accent"
    >
      {label}
    </Link>
  );

  if (!plan) {
    return (
      <div>
        <p className="text-sm text-muted">
          {disabled
            ? "No site plan yet."
            : "Trace the house, the lot and everything already in the yard over the satellite photo. On site, the headset’s corner walk drops it all into place."}
        </p>
        {!disabled && <div className="mt-4">{open("Start the site plan")}</div>}
      </div>
    );
  }

  const house = mainHouse(plan);
  const houseArea = house ? polygonArea(outlineOf(house)) : 0;
  const lotArea = plan.boundary.length >= 3 ? polygonArea(boundaryOutline(plan)) : 0;
  const sqft = (m2: number) => `${Math.round(m2 * SQ_FT_PER_SQ_M).toLocaleString("en-US")} sq ft`;
  const count = plan.features.length;

  return (
    <div>
      <Link href={href} className="block overflow-hidden rounded-[10px] border border-rule" aria-label="Open the site plan">
        <Thumbnail plan={plan} />
      </Link>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {plan.lookupAddress && (
          <>
            <dt className="text-muted">Address</dt>
            <dd className="truncate">{plan.lookupAddress}</dd>
          </>
        )}
        {houseArea > 0 && (
          <>
            <dt className="text-muted">House</dt>
            <dd>{sqft(houseArea)}</dd>
          </>
        )}
        {lotArea > 0 && (
          <>
            <dt className="text-muted">Lot</dt>
            <dd>{sqft(lotArea)}</dd>
          </>
        )}
        <dt className="text-muted">Shapes</dt>
        <dd>{count === 1 ? "1 shape" : `${count} shapes`}</dd>
        {(placed || savedAt) && (
          <>
            <dt className="text-muted">{placed ? "Placed on site" : "Saved"}</dt>
            <dd>
              {new Date(placed ?? savedAt!).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                timeZone: "America/Phoenix",
              })}
            </dd>
          </>
        )}
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {open(placed || disabled ? "View plan" : "Open builder")}
        {placed && <span className="text-xs text-muted">Edit its shapes on the headset for now.</span>}
      </div>
    </div>
  );
}

const W = 560;
const H = 300;
const PAD = 14;

/** The plan on paper, north up, fitted to the card. */
function Thumbnail({ plan }: { plan: SitePlan }) {
  const all: XZ[] = [...boundaryOutline(plan), ...plan.features.flatMap(outlineOf)];
  const xs = all.map((p) => p[0]);
  const zs = all.map((p) => p[1]);
  const [x0, x1, z0, z1] = all.length
    ? [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
    : [-10, 10, -10, 10];
  const scale = Math.min((W - 2 * PAD) / Math.max(1, x1 - x0), (H - 2 * PAD) / Math.max(1, z1 - z0));
  const S = ([x, z]: XZ): Pt => [W / 2 + (x - (x0 + x1) / 2) * scale, H / 2 + (z - (z0 + z1) / 2) * scale];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" style={{ background: SHEET_PAPER }}>
      <PlanPatterns />
      {plan.boundary.length >= 3 && <BoundaryArt pts={plan.boundary.map(S)} smooth={plan.boundarySmooth} halo={0} />}
      {byLayer(plan.features).map((f) => (
        <FeatureArt
          key={f.id}
          feature={f}
          pts={f.points.map(S)}
          radius={(f.radius ?? 0) * scale}
          smooth={f.smooth}
          halo={0}
          wash={0}
        />
      ))}
    </svg>
  );
}
