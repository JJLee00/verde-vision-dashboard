import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LivingBlueprint } from "@/lib/viewer/LivingBlueprint";
import { buildScene, buildRail, type RailRow } from "@/lib/viewer/scene";
import type { ProjectFileJSON } from "@/lib/viewer/types";
import { FIXTURE_PROJECT } from "@/lib/viewer/fixture";
import { StatusSelect, DetailsForm, NotesEditor } from "./editors";
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
  address: string | null;
  contactEmail: string | null;
  notes: string | null;
  coverUrl: string | null;
  videos: VideoItem[];
  userId: string;
  editable: boolean; // false until migration-009 has been run
  readOnly: boolean; // dev fixture
  rail: { rows: RailRow[]; subtotal: number | null };
};

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
    address: "27210 N Rio Verde Dr, Rio Verde, AZ",
    contactEmail: "hoffmans@example.com",
    notes: "Sample project — fields are read-only in fixture mode.",
    coverUrl: null,
    videos: [],
    userId: "fixture",
    editable: false,
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

  const { data: base, error } = await supabase
    .from("projects")
    .select(
      "id, name, status, created_at, project_date, estimate_amount, blueprint_path, estimate_path"
    )
    .eq("id", id)
    .single();
  if (error || !base) return null;

  // Migration-008 columns (3D plan), fetched tolerantly.
  let projectJson: ProjectFileJSON | null = null;
  let jsonUpdatedAt: string | null = null;
  const { data: json } = await supabase
    .from("projects")
    .select("project_json, project_json_updated_at")
    .eq("id", id)
    .single();
  if (json) {
    projectJson = (json.project_json as ProjectFileJSON | null) ?? null;
    jsonUpdatedAt = json.project_json_updated_at;
  }

  // Migration-009 columns (editable record), fetched tolerantly — until
  // that migration runs, the page renders read-only with a hint.
  let address: string | null = null;
  let contactEmail: string | null = null;
  let notes: string | null = null;
  let coverPath: string | null = null;
  let editable = false;
  const { data: rec } = await supabase
    .from("projects")
    .select("address, contact_email, notes, cover_path")
    .eq("id", id)
    .single();
  if (rec) {
    address = rec.address;
    contactEmail = rec.contact_email;
    notes = rec.notes;
    coverPath = rec.cover_path;
    editable = true;
  }

  // Signed URLs for the private buckets.
  const docPaths = [base.blueprint_path, base.estimate_path].filter(
    (p): p is string => Boolean(p)
  );
  const docUrls = new Map<string, string>();
  if (docPaths.length > 0) {
    const { data } = await supabase.storage
      .from("blueprints")
      .createSignedUrls(docPaths, 60 * 60);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) docUrls.set(item.path, item.signedUrl);
    }
  }

  let coverUrl: string | null = null;
  if (coverPath) {
    const { data } = await supabase.storage
      .from("project-media")
      .createSignedUrl(coverPath, 60 * 60);
    coverUrl = data?.signedUrl ?? null;
  }

  const videos: VideoItem[] = [];
  const videoPrefix = `${user.id}/${id}/videos`;
  const { data: videoObjs } = await supabase.storage
    .from("project-media")
    .list(videoPrefix, { limit: 50, sortBy: { column: "name", order: "desc" } });
  const videoPaths = (videoObjs ?? []).map((o) => `${videoPrefix}/${o.name}`);
  if (videoPaths.length > 0) {
    const { data } = await supabase.storage
      .from("project-media")
      .createSignedUrls(videoPaths, 60 * 60);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) {
        videos.push({
          path: item.path,
          name: item.path.split("/").pop() ?? "video",
          url: item.signedUrl,
        });
      }
    }
  }

  // Rail prices: designer's Prices-tab overrides, same as the viewer.
  const priceOverrides: Record<string, number> = {};
  const { data: priceRows } = await supabase
    .from("price_items")
    .select("name, price, category")
    .eq("category", "plant");
  for (const row of priceRows ?? []) {
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
    address,
    contactEmail,
    notes,
    coverUrl,
    videos,
    userId: user.id,
    editable,
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

  const disabled = data.readOnly || !data.editable;

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
            </p>
          </div>
        </div>
        <StatusSelect
          projectId={data.id}
          initial={data.status}
          disabled={disabled}
        />
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
          <SectionCard
            title="Details"
            action={
              <CoverUpload
                projectId={data.id}
                userId={data.userId}
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

          <SectionCard title="Walkthrough videos">
            <VideoManager
              projectId={data.id}
              userId={data.userId}
              videos={data.videos}
              disabled={disabled}
            />
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
