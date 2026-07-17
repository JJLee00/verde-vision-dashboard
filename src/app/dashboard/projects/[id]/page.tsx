import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership, getOrgMembers } from "@/lib/org";
import { LivingBlueprint } from "@/lib/viewer/LivingBlueprint";
import { buildScene, buildRail, type RailRow } from "@/lib/viewer/scene";
import type { ProjectFileJSON } from "@/lib/viewer/types";
import { FIXTURE_PROJECT } from "@/lib/viewer/fixture";
import { StatusSelect, DetailsForm, NotesEditor } from "./editors";
import { ShareLinkButtons } from "../../share-buttons";
import { ModeDonut } from "./mode-donut";
import { CoverUpload } from "./cover-upload";
import { VideoManager, type VideoItem } from "./video-manager";

// The project page: everything the dashboard knows about one project.
// The card on /dashboard stays a glance; this is the record — cover,
// editable status/details/notes, PDFs, the living-blueprint preview,
// plant material, and walkthrough videos. Designer-only; the client
// share link stays a curated viewer (/share/[token]).

export const metadata = { title: "Project — Verde Vision" };

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const longDate = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});
const syncStamp = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Phoenix",
});

type PageData = {
  id: string;
  name: string;
  status: string;
  createdAt: string | null;
  projectDate: string | null;
  estimateAmount: number | null;
  blueprintUrl: string | null;
  estimateUrl: string | null;
  projectJson: ProjectFileJSON | null;
  jsonUpdatedAt: string | null;
  // Public share-link tokens (migration 008; null until it has run).
  shareToken: string | null;
  crewToken: string | null;
  address: string | null;
  contactEmail: string | null;
  notes: string | null;
  coverUrl: string | null;
  videos: VideoItem[];
  anchors: { step: string; label: string; url: string }[];
  modeSeconds: Record<string, number> | null;
  // The designer whose folder holds this project's media ({client_id}/
  // {project_id}/…) — owner uploads land there too, one canonical spot.
  mediaOwnerId: string;
  // Set when an org owner views a designer's project.
  designerName: string | null;
  editable: boolean; // false until migration-009 has been run
  canEdit: boolean; // owns the project, or is the org owner (migration 011)
  readOnly: boolean; // dev fixture
  rail: { rows: RailRow[]; subtotal: number | null };
};

const ANCHOR_LABELS: Record<string, string> = {
  origin: "Origin",
  first: "First anchor",
  second: "Second anchor",
};

// Mode-time buckets in display order. "clientView" is the presenting
// overlay; the rest are base modes. Night is folded in only if used.
function buildFixtureData(): PageData {
  return {
    id: "fixture",
    name: FIXTURE_PROJECT.projectName,
    status: "pending",
    createdAt: "2026-07-14T17:00:00Z",
    projectDate: "2026-07-18",
    estimateAmount: 8460,
    blueprintUrl: null,
    estimateUrl: null,
    projectJson: FIXTURE_PROJECT,
    jsonUpdatedAt: new Date().toISOString(),
    shareToken: "00000000-0000-0000-0000-000000000000",
    crewToken: "00000000-0000-0000-0000-000000000001",
    address: "27210 N Rio Verde Dr, Rio Verde, AZ",
    contactEmail: "hoffmans@example.com",
    notes: "Sample project — fields are read-only in fixture mode.",
    coverUrl: null,
    videos: [],
    anchors: [],
    modeSeconds: { design: 5820, blueprint: 1560, clientView: 1320, night: 240 },
    mediaOwnerId: "fixture",
    designerName: null,
    editable: false,
    canEdit: false,
    readOnly: true,
    rail: buildRail(buildScene(FIXTURE_PROJECT), {}),
  };
}

async function loadPageData(id: string): Promise<PageData | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The base row, the migration-gated column sets, the price sheet, and
  // the caller's org membership are all independent — fire them together
  // instead of chaining round-trips. The migration-008/009 columns stay
  // in their own select() so the page still renders before those
  // migrations run. (The video listing moved to the second wave: its
  // folder is keyed by the project's designer, which needs the base row.)
  const [baseRes, jsonRes, recRes, anchorRes, priceRes, membership] =
    await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, name, status, created_at, project_date, estimate_amount, blueprint_path, estimate_path, client_id"
      )
      .eq("id", id)
      .single(),
    supabase
      .from("projects")
      .select("project_json, project_json_updated_at, share_token, crew_token")
      .eq("id", id)
      .single(),
    supabase
      .from("projects")
      .select("address, contact_email, notes, cover_path")
      .eq("id", id)
      .single(),
    supabase.from("projects").select("anchor_paths").eq("id", id).single(),
    supabase.from("price_items").select("name, price, category").eq("category", "plant"),
    getMembership(supabase, user.id),
  ]);

  const base = baseRes.data;
  if (baseRes.error || !base) return null;

  // Media lives under the designer's folder ({client_id}/{project_id}/…)
  // even when the org owner is the one viewing or uploading.
  const videoPrefix = `${base.client_id}/${id}/videos`;
  const isOwnerViewingOther =
    membership?.role === "owner" && base.client_id !== user.id;
  const canEditProject =
    base.client_id === user.id || membership?.role === "owner";

  // Attribution line for the owner ("Designer: …"), tolerant pre-011.
  let designerName: string | null = null;
  if (isOwnerViewingOther && membership) {
    const members = await getOrgMembers(supabase, membership.orgId);
    const m = members.find((mm) => mm.user_id === base.client_id);
    designerName = m ? (m.full_name ?? m.email) : "former team member";
  }

  let projectJson: ProjectFileJSON | null = null;
  let jsonUpdatedAt: string | null = null;
  let shareToken: string | null = null;
  let crewToken: string | null = null;
  if (jsonRes.data) {
    projectJson = (jsonRes.data.project_json as ProjectFileJSON | null) ?? null;
    jsonUpdatedAt = jsonRes.data.project_json_updated_at;
    shareToken = jsonRes.data.share_token;
    crewToken = jsonRes.data.crew_token;
  }

  // Migration-009 columns (editable record). Until that migration runs,
  // the query errors and the page renders read-only with a hint.
  let address: string | null = null;
  let contactEmail: string | null = null;
  let notes: string | null = null;
  let coverPath: string | null = null;
  let editable = false;
  if (recRes.data) {
    address = recRes.data.address;
    contactEmail = recRes.data.contact_email;
    notes = recRes.data.notes;
    coverPath = recRes.data.cover_path;
    editable = true;
  }

  // Signed URLs for the private buckets — a second wave, since these
  // depend on paths from the first. Run the doc, cover, and video URL
  // batches together.
  const docPaths = [base.blueprint_path, base.estimate_path].filter(
    (p): p is string => Boolean(p)
  );
  // anchor_paths is migration-010-gated, so read it tolerantly.
  const anchorPathMap =
    (anchorRes.data?.anchor_paths as Record<string, string> | null) ?? null;
  const anchorEntries = anchorPathMap
    ? (["origin", "first", "second"] as const)
        .filter((step) => anchorPathMap[step])
        .map((step) => ({ step, path: anchorPathMap[step] }))
    : [];
  const [docUrlRes, coverUrlRes, videoUrlRes, anchorUrlRes] = await Promise.all([
    docPaths.length > 0
      ? supabase.storage.from("blueprints").createSignedUrls(docPaths, 60 * 60)
      : Promise.resolve({ data: [] }),
    coverPath
      ? supabase.storage.from("project-media").createSignedUrl(coverPath, 60 * 60)
      : Promise.resolve({ data: null }),
    // List then sign in one chained step so this wave stays flat.
    (async () => {
      const listing = await supabase.storage
        .from("project-media")
        .list(videoPrefix, {
          limit: 50,
          sortBy: { column: "name", order: "desc" },
        });
      const videoPaths = (listing.data ?? []).map(
        (o) => `${videoPrefix}/${o.name}`
      );
      if (videoPaths.length === 0) return { data: [] };
      return supabase.storage
        .from("project-media")
        .createSignedUrls(videoPaths, 60 * 60);
    })(),
    anchorEntries.length > 0
      ? supabase.storage
          .from("project-media")
          .createSignedUrls(
            anchorEntries.map((a) => a.path),
            60 * 60
          )
      : Promise.resolve({ data: [] }),
  ]);

  const docUrls = new Map<string, string>();
  for (const item of docUrlRes.data ?? []) {
    if (item.path && item.signedUrl) docUrls.set(item.path, item.signedUrl);
  }

  const coverUrl = coverUrlRes.data?.signedUrl ?? null;

  const videos: VideoItem[] = [];
  for (const item of videoUrlRes.data ?? []) {
    if (item.path && item.signedUrl) {
      videos.push({
        path: item.path,
        name: item.path.split("/").pop() ?? "video",
        url: item.signedUrl,
      });
    }
  }

  // Match anchor signed URLs back to their step by path (same order in,
  // but pair explicitly rather than trusting the index).
  const anchorUrlByPath = new Map<string, string>();
  for (const item of anchorUrlRes.data ?? []) {
    if (item.path && item.signedUrl) anchorUrlByPath.set(item.path, item.signedUrl);
  }
  const anchors = anchorEntries
    .map((a) => ({
      step: a.step,
      label: ANCHOR_LABELS[a.step] ?? a.step,
      url: anchorUrlByPath.get(a.path) ?? "",
    }))
    .filter((a) => a.url);

  // Rail prices: designer's Prices-tab overrides, same as the viewer.
  // Fetched in the first parallel wave above.
  const priceOverrides: Record<string, number> = {};
  for (const row of priceRes.data ?? []) {
    priceOverrides[row.name.toLowerCase()] = Number(row.price);
  }

  return {
    id: base.id,
    name: base.name,
    status: base.status,
    createdAt: base.created_at,
    projectDate: base.project_date,
    estimateAmount: base.estimate_amount,
    blueprintUrl: base.blueprint_path
      ? (docUrls.get(base.blueprint_path) ?? null)
      : null,
    estimateUrl: base.estimate_path
      ? (docUrls.get(base.estimate_path) ?? null)
      : null,
    projectJson,
    jsonUpdatedAt,
    shareToken,
    crewToken,
    address,
    contactEmail,
    notes,
    coverUrl,
    videos,
    anchors,
    modeSeconds:
      (projectJson?.modeSeconds as Record<string, number> | null) ?? null,
    mediaOwnerId: base.client_id,
    designerName,
    editable,
    canEdit: canEditProject,
    readOnly: false,
    rail: projectJson
      ? buildRail(buildScene(projectJson), priceOverrides)
      : { rows: [], subtotal: null },
  };
}

function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-edge bg-card p-5 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-faint">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const data =
    id === "fixture" && process.env.NODE_ENV === "development"
      ? buildFixtureData()
      : await loadPageData(id);
  if (!data) notFound();

  const disabled = data.readOnly || !data.editable || !data.canEdit;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-12 lg:py-10">
      <Link
        href="/dashboard"
        className="text-sm text-muted transition hover:text-ink"
      >
        ← Projects
      </Link>

      {/* header */}
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-5">
          {data.coverUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.coverUrl}
              alt=""
              className="h-20 w-28 shrink-0 rounded-[10px] border border-edge object-cover"
            />
          )}
          <div className="min-w-0">
            <h1 className="truncate font-serif text-4xl text-ink">{data.name}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              {data.createdAt && (
                <span>Created {longDate.format(new Date(data.createdAt))}</span>
              )}
              {data.projectDate && (
                <span className="text-faint">
                  · Project date{" "}
                  {longDate.format(new Date(`${data.projectDate}T00:00:00`))}
                </span>
              )}
              {data.jsonUpdatedAt && (
                <span className="text-faint">
                  · Synced from headset{" "}
                  {syncStamp.format(new Date(data.jsonUpdatedAt))}
                </span>
              )}
              {data.designerName && (
                <span className="text-faint">· Designer: {data.designerName}</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {data.projectJson && data.shareToken && data.crewToken && (
            <ShareLinkButtons
              clientToken={data.shareToken}
              crewToken={data.crewToken}
            />
          )}
          <StatusSelect
            projectId={data.id}
            initial={data.status}
            disabled={disabled}
          />
        </div>
      </div>

      {!data.editable && !data.readOnly && (
        <p className="mt-4 rounded-lg border border-gold/40 bg-gold/10 px-4 py-2.5 text-sm text-gold">
          Editing is off until migration-009 has been run in Supabase — status,
          details, notes, and media will unlock after that.
        </p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* ── left: plan + documents + material ── */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <div className="overflow-hidden rounded-[14px] border border-edge shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
            {data.projectJson ? (
              <Link
                href={`/viewer/${data.id}`}
                className="group relative block h-[340px] bg-[#ebe0cb]"
                aria-label="Open the full 3D viewer"
              >
                <LivingBlueprint
                  project={data.projectJson}
                  projectName={data.name}
                  showPrices={false}
                  embed
                />
                <span className="absolute right-3.5 top-3 rounded-lg border border-rule-strong bg-card/80 px-3 py-1.5 text-[13px] font-semibold text-ink backdrop-blur transition group-hover:bg-card">
                  Open 3D viewer ⤢
                </span>
              </Link>
            ) : (
              <div className="flex h-[220px] flex-col items-center justify-center gap-2 bg-[#ebe0cb] px-6 text-center">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
                  No 3D plan yet
                </p>
                <p className="max-w-sm text-sm text-muted">
                  Export a blueprint or estimate from the headset and the
                  living blueprint will appear here.
                </p>
              </div>
            )}
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <SectionCard title="Blueprint">
              {data.blueprintUrl ? (
                <a
                  href={data.blueprintUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-accent underline decoration-accent-soft underline-offset-4 transition hover:text-accent-bright"
                >
                  View PDF
                </a>
              ) : (
                <p className="text-sm text-muted">No blueprint exported yet.</p>
              )}
            </SectionCard>
            <SectionCard title="Estimate">
              {data.estimateAmount != null ? (
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-2xl font-semibold tabular-nums text-ink">
                    {currency.format(data.estimateAmount)}
                  </span>
                  {data.estimateUrl && (
                    <a
                      href={data.estimateUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-accent underline decoration-accent-soft underline-offset-4 transition hover:text-accent-bright"
                    >
                      View PDF
                    </a>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted">No estimate synced yet.</p>
              )}
            </SectionCard>
          </div>

          <SectionCard
            title="Plant material"
            action={
              data.projectJson ? (
                <Link
                  href={`/viewer/${data.id}`}
                  className="text-xs font-semibold text-accent transition hover:text-accent-bright"
                >
                  Open in viewer →
                </Link>
              ) : undefined
            }
          >
            {data.rail.rows.length === 0 ? (
              <p className="text-sm text-muted">
                Plant material appears after the first headset sync.
              </p>
            ) : (
              <div>
                {data.rail.rows.map((row) => (
                  <div
                    key={row.model}
                    className="flex items-center gap-3 border-b border-rule py-2 last:border-b-0"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/50 font-mono text-[9px] font-semibold text-accent">
                      {row.meta.code}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-body">
                      {row.meta.name}
                      <span className="text-muted">
                        {" "}
                        ×{row.qty}
                        {row.unitLabel && ` · ${row.unitLabel}`}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-sm tabular-nums text-body">
                      {row.lineTotal != null ? currency.format(row.lineTotal) : "—"}
                    </span>
                  </div>
                ))}
                {data.rail.subtotal != null && (
                  <div className="flex items-baseline justify-between pt-3">
                    <span className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-faint">
                      Materials subtotal
                    </span>
                    <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                      {currency.format(data.rail.subtotal)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </SectionCard>
        </div>

        {/* ── right: record ── */}
        <div className="flex flex-col gap-6">
          <SectionCard title="Time in each mode">
            {data.modeSeconds ? (
              <ModeDonut modeSeconds={data.modeSeconds} />
            ) : (
              <p className="text-sm text-muted">
                Recorded on the headset and synced with the design — appears
                after the next sync. Only you see this; it&apos;s never on a
                client link.
              </p>
            )}
          </SectionCard>

          <SectionCard
            title="Details"
            action={
              <CoverUpload
                projectId={data.id}
                userId={data.mediaOwnerId}
                hasCover={Boolean(data.coverUrl)}
                disabled={disabled}
              />
            }
          >
            <DetailsForm
              projectId={data.id}
              initialAddress={data.address}
              initialContactEmail={data.contactEmail}
              disabled={disabled}
            />
          </SectionCard>

          <SectionCard title="Notes">
            <NotesEditor
              projectId={data.id}
              initial={data.notes}
              disabled={disabled}
            />
          </SectionCard>

          {data.anchors.length > 0 && (
            <SectionCard title="Alignment anchors">
              <div className="flex flex-col gap-3">
                {data.anchors.map((a) => (
                  <div key={a.step}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.url}
                      alt={`${a.label} reference photo`}
                      className="w-full rounded-[10px] border border-edge object-cover"
                    />
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
                      {a.label}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-faint">
                Reference shots from setup — line these up to re-align the
                project on a return visit.
              </p>
            </SectionCard>
          )}

          <SectionCard title="Walkthrough videos">
            <VideoManager
              projectId={data.id}
              userId={data.mediaOwnerId}
              videos={data.videos}
              disabled={disabled}
            />
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
