import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership, getOrgMembers } from "@/lib/org";
import { DeleteProject } from "./delete-project";
import { LivingBlueprint } from "@/lib/viewer/LivingBlueprint";
import { buildScene, buildRail, type RailRow } from "@/lib/viewer/scene";
import type { ProjectFileJSON } from "@/lib/viewer/types";
import { pricesFromRows } from "@/lib/price-book";
import { FIXTURE_PROJECT } from "@/lib/viewer/fixture";
import { StatusSelect, NotesEditor } from "./editors";
import { SiteMarkers } from "./site-markers";
import {
  anchorNotesFrom,
  buildSiteMarkers,
  registrationsFrom,
  type AnchorStep,
  type SiteMarker,
} from "@/lib/markers";
import { EditProjectButton } from "@/app/dashboard/project-details-dialog";
import { ShareLinkButtons } from "../../share-buttons";
import { ModeDonut } from "./mode-donut";
import { VideoManager, type VideoItem } from "./video-manager";
import { HouseOutline } from "./house-outline";
import { readStored, type StoredBlueprint } from "@/lib/blueprint/stored";

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
  customerName: string | null;
  address: string | null;
  contactEmail: string | null;
  notes: string | null;
  videos: VideoItem[];
  markers: SiteMarker[];
  // The house outline traced for the headset (migration 020).
  houseOutline: {
    stored: StoredBlueprint;
    fetchedAt: string | null;
  } | null;
  houseOutlineReady: boolean; // false until migration-020 has been run
  modeSeconds: Record<string, number> | null;
  // The designer whose folder holds this project's media ({client_id}/
  // {project_id}/…) — owner uploads land there too, one canonical spot.
  mediaOwnerId: string;
  // Set when an org owner views a designer's project.
  designerName: string | null;
  editable: boolean; // false until migration-009 has been run
  canEdit: boolean; // owns the project, or is the org owner (migration 011)
  readOnly: boolean; // dev fixture
  deleted: boolean; // soft-deleted (migration 018); false before it has run
  rail: { rows: RailRow[]; subtotal: number | null };
};

// A made-up yard and L-shaped house for the dev fixture — synthetic on
// purpose, so no real property's outline lives in the repo. On the aerial
// it lands on some real neighbourhood; it isn't meant to match a roof.
const FIXTURE_OUTLINE: StoredBlueprint = {
  version: 1,
  provider: "trace",
  lookupAddress: "27210 N Rio Verde Dr, Rio Verde, AZ",
  candidate: {
    apn: "",
    address: "27210 N Rio Verde Dr, Rio Verde, AZ",
    centroid: { lat: 33.72, lng: -111.67 },
    parcelXZ: [
      [-16, -22],
      [16, -22],
      [16, 22],
      [-16, 22],
    ],
    attributes: {},
    houseXZ: [
      [-10, -14],
      [8, -14],
      [8, -2],
      [0, -2],
      [0, 6],
      [-10, 6],
    ],
    houseAreaSqFt: 3186,
    imagery: null,
    warnings: [],
  },
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
    customerName: "Dani Hartley",
    address: "27210 N Rio Verde Dr, Rio Verde, AZ",
    contactEmail: "hoffmans@example.com",
    notes: "Sample project — fields are read-only in fixture mode.",
    videos: [],
    markers: buildSiteMarkers([], {}, {
      origin: { text: "Garage frame, 4 ft up", updated_at: "2026-10-02T18:00:00Z" },
    }),
    houseOutline: { stored: FIXTURE_OUTLINE, fetchedAt: "2026-07-12T16:00:00Z" },
    houseOutlineReady: true,
    modeSeconds: { design: 5820, blueprint: 1560, clientView: 1320, night: 240 },
    mediaOwnerId: "fixture",
    designerName: null,
    editable: false,
    canEdit: false,
    readOnly: true,
    deleted: false,
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
  const [
    baseRes,
    jsonRes,
    recRes,
    anchorRes,
    deletedRes,
    customerRes,
    outlineRes,
    notesRes,
    priceRes,
    membership,
  ] = await Promise.all([
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
    // Its own select, like anchor_paths above: a database that hasn't run
    // migration-018 has no such column, and the project page must still open.
    supabase.from("projects").select("deleted_at").eq("id", id).single(),
    // Its own select for the same reason: migration-019 may not have run.
    supabase.from("projects").select("customer_name").eq("id", id).single(),
    // And again for migration-020.
    supabase
      .from("projects")
      .select("blueprint_payload, blueprint_fetched_at")
      .eq("id", id)
      .single(),
    // And again for migration-021: the plate notes live in their own column
    // now, two-way with the headset.
    supabase.from("projects").select("anchor_notes").eq("id", id).single(),
    supabase.from("plant_prices").select("plant_key, size, price"),
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
  let editable = false;
  if (recRes.data) {
    address = recRes.data.address;
    contactEmail = recRes.data.contact_email;
    notes = recRes.data.notes;
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
  const outlineRow = outlineRes.data as {
    blueprint_payload?: unknown;
    blueprint_fetched_at?: string | null;
  } | null;
  const storedOutline = readStored(outlineRow?.blueprint_payload);

  // No cover photo here: it is set and shown on the project CARD, so
  // signing a URL for it on every project page render bought nothing.
  const [docUrlRes, videoUrlRes, anchorUrlRes] = await Promise.all([
    docPaths.length > 0
      ? supabase.storage.from("blueprints").createSignedUrls(docPaths, 60 * 60)
      : Promise.resolve({ data: [] }),
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
  // One row per alignment point, whether or not a plate or a photo exists —
  // "Point 2 has no plate" is the thing worth knowing, and a list that only
  // shows what is present can never say it.
  const photoUrlByStep: Partial<Record<AnchorStep, string>> = {};
  for (const entry of anchorEntries) {
    const url = anchorUrlByPath.get(entry.path);
    if (url) photoUrlByStep[entry.step as AnchorStep] = url;
  }
  const markers = buildSiteMarkers(
    registrationsFrom(projectJson),
    photoUrlByStep,
    anchorNotesFrom(notesRes.data?.anchor_notes)
  );

  // Rail prices: the org's grid, same as the viewer, the estimate and the
  // headset — blank cells are $0. Fetched in the first parallel wave above.
  const priceOverrides = pricesFromRows(priceRes.data);

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
    customerName:
      (customerRes.data as { customer_name?: string | null } | null)
        ?.customer_name ?? null,
    address,
    contactEmail,
    notes,
    videos,
    markers,
    houseOutline: storedOutline
      ? {
          stored: storedOutline,
          fetchedAt: outlineRow?.blueprint_fetched_at ?? null,
        }
      : null,
    houseOutlineReady: !outlineRes.error,
    modeSeconds:
      (projectJson?.modeSeconds as Record<string, number> | null) ?? null,
    mediaOwnerId: base.client_id,
    designerName,
    editable,
    canEdit: canEditProject,
    readOnly: false,
    deleted: Boolean(
      (deletedRes.data as { deleted_at?: string | null } | null)?.deleted_at
    ),
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ published?: string }>;
}) {
  const { id } = await params;
  // Publishing a revision lands here rather than leaving the designer in
  // the editor wondering whether it took.
  const published = (await searchParams)?.published ?? null;

  const data =
    id === "fixture" && process.env.NODE_ENV === "development"
      ? buildFixtureData()
      : await loadPageData(id);
  if (!data) notFound();

  const disabled = data.readOnly || !data.editable || !data.canEdit;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-12 lg:py-10">
      {published && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[14px] border border-accent/40 bg-accent-soft/30 px-5 py-3.5">
          <span className="text-sm font-semibold text-accent-dim">
            Revision {published} published
          </span>
          <span className="text-sm text-muted">
            The estimate and the client&apos;s view are up to date.
          </span>
        </div>
      )}
      <Link
        href="/dashboard"
        className="text-sm text-muted transition hover:text-ink"
      >
        ← Projects
      </Link>

      {/* header */}
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-5">
          <div className="min-w-0">
            <h1 className="truncate font-serif text-4xl text-ink">{data.name}</h1>

            {/* Who and where, as part of the title rather than a form in the
                sidebar. These are what the project IS; they were being typed
                into a card below the fold, which is where settings live, not
                identity. Edit details opens the same dialog the project was
                created with. */}
            {(data.customerName || data.address || data.contactEmail) && (
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.95rem] text-body">
                {data.customerName && <span>{data.customerName}</span>}
                {data.address && (
                  <span className={data.customerName ? "text-muted" : ""}>
                    {data.customerName && "· "}
                    {data.address}
                  </span>
                )}
                {data.contactEmail && (
                  <a
                    href={`mailto:${data.contactEmail}`}
                    className="text-muted underline decoration-rule-strong underline-offset-4 transition hover:text-accent"
                  >
                    {(data.customerName || data.address) && "· "}
                    {data.contactEmail}
                  </a>
                )}
              </p>
            )}

            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-faint">
              {data.createdAt && (
                <span>Created {longDate.format(new Date(data.createdAt))}</span>
              )}
              {data.jsonUpdatedAt && (
                <span>
                  · Synced from headset{" "}
                  {syncStamp.format(new Date(data.jsonUpdatedAt))}
                </span>
              )}
              {data.designerName && <span>· Designer: {data.designerName}</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!disabled && (
            <EditProjectButton
              projectId={data.id}
              initial={{
                name: data.name,
                customerName: data.customerName ?? "",
                address: data.address ?? "",
                contactEmail: data.contactEmail ?? "",
              }}
            />
          )}
          {data.projectJson && data.shareToken && data.crewToken && (
            <ShareLinkButtons
              clientToken={data.shareToken}
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
            <SectionCard
              title="Estimate"
              action={
                <Link
                  href={`/dashboard/projects/${data.id}/estimate`}
                  className="text-xs font-semibold text-accent transition hover:text-accent-bright"
                >
                  Open builder →
                </Link>
              }
            >
              {data.estimateAmount != null ? (
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-2xl font-semibold tabular-nums text-ink">
                    {currency.format(data.estimateAmount)}
                  </span>
                  {/* The estimate page, not the PDF the headset used to
                      upload. That copy priced plants off the catalog and knew
                      nothing about manual lines, tax or the deposit, so a
                      project could offer two proposals with different totals
                      and no way to tell which was current. The live one is
                      rendered from the rows, under the firm's letterhead. */}
                  <Link
                    href={`/dashboard/projects/${data.id}/estimate`}
                    className="text-sm font-semibold text-accent underline decoration-accent-soft underline-offset-4 transition hover:text-accent-bright"
                  >
                    Open estimate
                  </Link>
                </div>
              ) : (
                <p className="text-sm text-muted">
                  Nothing synced yet — the builder is where irrigation, demo,
                  delivery and labor get added.
                </p>
              )}
            </SectionCard>
          </div>

          <SectionCard title="House outline">
            <HouseOutline
              projectId={data.id}
              address={data.address}
              outline={data.houseOutline}
              ready={data.houseOutlineReady}
              disabled={disabled}
            />
          </SectionCard>

          <SectionCard title="Site markers">
            <SiteMarkers
              projectId={data.id}
              mediaOwnerId={data.mediaOwnerId}
              markers={data.markers}
              disabled={disabled}
            />
            <p className="mt-4 text-[11px] text-faint">
              The plates the headset locks onto to re-align this project on a
              return visit. Photos and notes are for finding them again on
              site, and both reach the headset with the project — the headset
              has no camera of its own, so adding a photo here is often easier
              than in the app.
            </p>
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

          <SectionCard title="Notes">
            <NotesEditor
              projectId={data.id}
              initial={data.notes}
              disabled={disabled}
            />
          </SectionCard>

          <SectionCard title="Walkthrough videos">
            <VideoManager
              projectId={data.id}
              userId={data.mediaOwnerId}
              videos={data.videos}
              disabled={disabled}
            />
            {/* Stated here rather than behind a per-video toggle: the
                designer decides what to upload, and a clear sentence at the
                point of uploading is worth more than a checkbox they have to
                find. */}
            <p className="mt-3 text-[11px] text-faint">
              Anything here appears on the client link. Keep rough takes off
              the project.
            </p>
          </SectionCard>
        </div>
      </div>

      {!data.readOnly && data.canEdit && (
        <DeleteProject
          projectId={data.id}
          projectName={data.name}
          deleted={data.deleted}
        />
      )}
    </div>
  );
}
