import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/org";
import { FIXTURE_PROJECT } from "@/lib/viewer/fixture";
import type { ProjectFileJSON } from "@/lib/viewer/types";
import { FIXTURE_PLAN } from "@/lib/site-plan/fixture";
import { readPlan } from "@/lib/site-plan/plan";
import { placedAt, placedPlan } from "@/lib/site-plan/placed";
import { SitePlanBuilder } from "./builder";

// The site plan builder, full screen. Its card on the project page links
// here.

export const metadata = { title: "Site plan — Verde Vision" };

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });

export default async function SitePlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (id === "fixture" && process.env.NODE_ENV === "development") {
    return (
      <SitePlanBuilder
        projectId="fixture"
        projectName={FIXTURE_PROJECT.projectName}
        initial={FIXTURE_PLAN}
        readOnly={null}
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
  const [baseRes, jsonRes, planRes, membership] = await Promise.all([
    supabase.from("projects").select("id, name, client_id").eq("id", id).single(),
    supabase.from("projects").select("project_json").eq("id", id).single(),
    supabase.from("projects").select("blueprint_payload").eq("id", id).single(),
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
  if (project?.outlinePlacement) {
    const at = placedAt(project);
    const placed = plan ? placedPlan(plan, project) : null;
    initial = placed ?? plan;
    readOnly =
      `Placed on site${at ? ` ${day.format(at)}` : ""}. The headset holds this plan now — edit its shapes there for now.` +
      (plan && !placed ? " This shows the plan as it was traced." : "");
  } else if (!canEdit) {
    readOnly = "Only the project's designer or the firm's owner can change this site plan.";
  }

  return (
    <SitePlanBuilder
      projectId={base.id}
      projectName={base.name}
      initial={initial}
      readOnly={readOnly}
      fixture={false}
    />
  );
}
