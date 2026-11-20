import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/org";
import { FIXTURE_PROJECT } from "@/lib/viewer/fixture";
import type { ProjectFileJSON } from "@/lib/viewer/types";
import { pricesFromRows } from "@/lib/price-book";
import { FIXTURE_DESIGNED, FIXTURE_PLAN, fixtureWalked } from "@/lib/site-plan/fixture";
import { readPlan } from "@/lib/site-plan/plan";
import { placedAt, placedPlan, walkFit } from "@/lib/site-plan/placed";
import { headsetDrew } from "@/lib/site-plan/sheet-design";
import { SitePlanBuilder, type Walked } from "./builder";

// The site plan builder, full screen. Its card on the project page links
// here.

export const metadata = { title: "Site plan — Verde Vision" };

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });

export default async function SitePlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;

  if (id === "fixture" && process.env.NODE_ENV === "development") {
    // ?design=1: with a design drawn on it. ?walked=1: after a corner walk.
    const q = await searchParams;
    const walked = q.walked ? fixtureWalked() : null;
    const fit = walked && walkFit(walked.project);
    return (
      <SitePlanBuilder
        projectId="fixture"
        projectName={FIXTURE_PROJECT.projectName}
        initial={walked ? placedPlan(walked.plan, walked.project) : q.design ? FIXTURE_DESIGNED : FIXTURE_PLAN}
        readOnly={walked ? PLACED("Nov 12", true) : null}
        designReadOnly={null}
        walked={walked && fit ? { project: walked.project, fit } : null}
        prices={FIXTURE_PRICES}
        userId="fixture"
        planImageUrl={null}
        fixture
      />
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The plan's column in its own select, like the project page: a database
  // that hasn't run migration-020 must still answer the rest.
  const [baseRes, jsonRes, planRes, priceRes, membership] = await Promise.all([
    supabase.from("projects").select("id, name, client_id").eq("id", id).single(),
    supabase.from("projects").select("project_json").eq("id", id).single(),
    supabase.from("projects").select("blueprint_payload").eq("id", id).single(),
    // The org's grid, as the viewer and the estimate read it; RLS keeps it
    // to the org.
    supabase.from("plant_prices").select("plant_key, size, price"),
    getMembership(supabase, user.id),
  ]);
  const base = baseRes.data;
  if (baseRes.error || !base) notFound();
  if (planRes.error) {
    return (
      <p className="mx-auto max-w-xl px-6 py-16 text-sm text-muted">
        Run migration-020 in Supabase and site plans can be drawn here.
      </p>
    );
  }

  const project = (jsonRes.data?.project_json as ProjectFileJSON | null) ?? null;
  const plan = readPlan(planRes.data?.blueprint_payload);
  const canEdit = base.client_id === user.id || membership?.role === "owner";

  let initial = plan;
  let readOnly: string | null = null;
  let designReadOnly: string | null = null;
  let walked: Walked | null = null;
  if (project?.outlinePlacement) {
    const at = placedAt(project);
    const placed = plan ? placedPlan(plan, project) : null;
    const fit = walkFit(project);
    initial = placed ?? plan;
    readOnly = PLACED(at ? day.format(at) : null, canEdit && fit != null) + (plan && !placed ? " This shows the plan as it was traced." : "");
    // Without the walk's fit there's no way to lay the design on the plan.
    if (fit) walked = { project, fit };
    else designReadOnly = "This plan was placed before the dashboard kept the walk's fit, so its design changes on the headset or in the 3D viewer.";
  } else if (headsetDrew(project)) {
    // Designed in the yard, with no walk to lay it on the plan.
    designReadOnly = "This design was made on the headset, so it changes there or in the 3D viewer.";
  }
  if (!canEdit) {
    readOnly = readOnly ?? "Only the project's designer or the firm's owner can change this site plan.";
    designReadOnly = "Only the project's designer or the firm's owner can change this design.";
  }

  // project-media is private: the uploaded plan is read through a signed
  // link, long enough for a working session.
  const imagePath = initial?.planImage?.path;
  const planImageUrl = imagePath
    ? ((await supabase.storage.from("project-media").createSignedUrl(imagePath, 60 * 60 * 8)).data?.signedUrl ?? null)
    : null;

  return (
    <SitePlanBuilder
      projectId={base.id}
      projectName={base.name}
      initial={initial}
      readOnly={readOnly}
      designReadOnly={designReadOnly}
      walked={walked}
      prices={pricesFromRows(priceRes.data)}
      userId={user.id}
      planImageUrl={planImageUrl}
      fixture={false}
    />
  );
}

const PLACED = (on: string | null, designHere: boolean) =>
  `Placed on site${on ? ` ${on}` : ""}. The headset holds the yard's shapes now — change them there.` +
  (designHere ? " The design still changes here, on the Design tab." : "");

/** Made-up prices for the fixture, so its totals read like a bid. */
const FIXTURE_PRICES: Record<string, number> = {
  'blue palo verde|24" Box': 265,
  'texas ebony|24" Box': 245,
  "red yucca|5g": 28,
  "golden barrel cactus|5g": 35,
  "desert spoon|15g": 75,
  "path light|Small": 140,
  'mulga|36" Box': 595,
  "texas sage|5g": 24,
  "surface:turf|sqft": 9.5,
  "surface:travertine|sqft": 14,
};
