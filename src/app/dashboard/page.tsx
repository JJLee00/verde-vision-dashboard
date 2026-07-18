import Link from "next/link";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMembership, getOrgMembers, memberName } from "@/lib/org";
import { SearchBar } from "./search-bar";
import { StatusFilter } from "./status-filter";
import { PeriodFilter } from "./period-filter";
import { DesignerFilter } from "./designer-filter";
import { ShareLinkButtons } from "./share-buttons";

type Estimate = {
  id: string;
  file_name: string;
  file_path: string;
  row_count: number | null;
  created_at: string;
};

type Project = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  project_date: string | null;
  estimate_amount: number | null;
  blueprint_path: string | null;
  client_id: string;
  plant_estimates: Estimate[];
};

type ProjectSummary = {
  status: string;
  estimate_amount: number | null;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const longDate = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

function greetingForPhoenix() {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Phoenix",
    }).format(new Date())
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// Start of the selected calendar period in Phoenix time (fixed UTC-7, no DST),
// as an ISO timestamp for filtering `created_at`. null = all time.
function periodStart(period: string | undefined): string | null {
  if (!period) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const OFFSET = "-07:00";
  const iso = (yy: number, mm: number, dd: number) =>
    `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}T00:00:00${OFFSET}`;

  if (period === "year") return iso(y, 1, 1);
  if (period === "month") return iso(y, m, 1);
  if (period === "week") {
    // Back up to Monday. getUTCDay on a UTC-midnight date avoids TZ drift.
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
    const monday = new Date(Date.UTC(y, m - 1, d - ((dow + 6) % 7)));
    return iso(
      monday.getUTCFullYear(),
      monday.getUTCMonth() + 1,
      monday.getUTCDate()
    );
  }
  return null;
}

function displayName(user: User) {
  const fromMetadata =
    user.user_metadata?.full_name ?? user.user_metadata?.name;
  const name: string = fromMetadata || user.email?.split("@")[0] || "there";
  const first = name.trim().split(/\s+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function initials(user: User) {
  const fromMetadata =
    user.user_metadata?.full_name ?? user.user_metadata?.name;
  const source: string = fromMetadata || user.email?.split("@")[0] || "?";
  const words = source.trim().split(/\s+/);
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

// Latest activity we can show without an updated_at column: the newest
// estimate upload, or the project's creation.
function lastUpdated(project: Project) {
  const dates = [
    project.created_at,
    ...project.plant_estimates.map((e) => e.created_at),
  ];
  return new Date(Math.max(...dates.map((d) => new Date(d).getTime())));
}

// Project workflow: pending (awaiting approval) → approved → installed.
const STATUS_STYLES: Record<string, string> = {
  pending: "border-gold/40 bg-gold/10 text-gold",
  approved: "border-accent/40 bg-accent-soft text-accent-dim",
  installed: "border-clay/40 bg-clay/10 text-clay",
};

function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] ${
        STATUS_STYLES[status] ?? "border-rule-strong bg-paper-deep text-muted"
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

function NoPhotoSlot() {
  return (
    <div className="flex h-full min-h-52 flex-col items-center justify-center gap-2.5 rounded-[10px] border border-rule bg-ink/[0.05]">
      <svg
        className="h-8 w-8 text-faint"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="5" width="18" height="15" rx="2" />
        <circle cx="9" cy="10" r="1.6" />
        <path d="m5 19 5.2-5.2a1.5 1.5 0 0 1 2.1 0L17 18.5m-2.5-2.5 1.8-1.8a1.5 1.5 0 0 1 2.1 0L21 16.5" />
      </svg>
      <span className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
        No photo yet
      </span>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-edge bg-card p-5 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
        {label}
      </p>
      <p className="mt-1.5 font-serif text-3xl text-ink">{value}</p>
    </div>
  );
}

function StatCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
        {label}
      </dt>
      <dd className="mt-1.5 text-sm text-body">{children}</dd>
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    period?: string;
    designer?: string;
  }>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { q, status, period, designer } = await searchParams;
  const cutoff = periodStart(period);

  // Owners of a multi-member org get the grouped team view; everyone
  // else (designers, single-member orgs, pre-007 databases) keeps the
  // flat list exactly as before.
  const membership = await getMembership(supabase, user.id);
  const members =
    membership?.role === "owner"
      ? await getOrgMembers(supabase, membership.orgId)
      : [];
  const groupedMode = membership?.role === "owner" && members.length > 1;
  const designerFilter = groupedMode && designer ? designer : null;

  let query = supabase
    .from("projects")
    .select(
      "id, name, description, status, created_at, project_date, estimate_amount, blueprint_path, client_id, plant_estimates(id, file_name, file_path, row_count, created_at)"
    )
    .order("created_at", { ascending: false })
    .order("created_at", {
      referencedTable: "plant_estimates",
      ascending: false,
    });

  if (q) {
    query = query.ilike("name", `%${q}%`);
  }
  if (status) {
    query = query.eq("status", status);
  }
  if (cutoff) {
    query = query.gte("created_at", cutoff);
  }
  if (designerFilter) {
    query = query.eq("client_id", designerFilter);
  }

  // Stat cards summarize the same time range (but ignore search/status, which
  // only narrow the list below).
  let summaryQuery = supabase
    .from("projects")
    .select("status, estimate_amount");
  if (cutoff) {
    summaryQuery = summaryQuery.gte("created_at", cutoff);
  }
  if (designerFilter) {
    summaryQuery = summaryQuery.eq("client_id", designerFilter);
  }

  const [{ data: projects, error }, { data: allProjects }] = await Promise.all([
    query.returns<Project[]>(),
    summaryQuery.returns<ProjectSummary[]>(),
  ]);

  const totalCount = allProjects?.length ?? 0;
  const pendingCount =
    allProjects?.filter((p) => p.status === "pending").length ?? 0;
  const estimateTotal =
    allProjects?.reduce((sum, p) => sum + (p.estimate_amount ?? 0), 0) ?? 0;

  // Estimate PDFs (migration 006) are fetched separately and tolerantly so
  // the dashboard still renders before that migration has been run.
  const { data: estimateRows } = await supabase
    .from("projects")
    .select("id, estimate_path");
  const estimatePathById = new Map<string, string>(
    (estimateRows ?? [])
      .filter((r): r is { id: string; estimate_path: string } =>
        Boolean(r.estimate_path)
      )
      .map((r) => [r.id, r.estimate_path])
  );

  // Same tolerance for the 3D plan column (migration 008): the viewer
  // button only lights up once the headset has synced a project JSON.
  const { data: planRows } = await supabase
    .from("projects")
    .select("id, project_json_updated_at, share_token, crew_token");
  const has3DPlan = new Set(
    (planRows ?? [])
      .filter((r) => Boolean(r.project_json_updated_at))
      .map((r) => r.id)
  );
  // Share links only make sense once a 3D plan exists (the public page
  // 404s without project_json), so key the token map the same way.
  const shareTokensById = new Map(
    (planRows ?? [])
      .filter((r) => r.project_json_updated_at && r.share_token && r.crew_token)
      .map((r) => [r.id, { client: r.share_token, crew: r.crew_token }])
  );

  // Cover photos (migration 009), also tolerant.
  const { data: coverRows } = await supabase
    .from("projects")
    .select("id, cover_path");
  const coverPathById = new Map<string, string>(
    (coverRows ?? [])
      .filter((r): r is { id: string; cover_path: string } =>
        Boolean(r.cover_path)
      )
      .map((r) => [r.id, r.cover_path])
  );
  const coverUrls = new Map<string, string>();
  if (coverPathById.size > 0) {
    const { data } = await supabase.storage
      .from("project-media")
      .createSignedUrls([...coverPathById.values()], 60 * 60);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) coverUrls.set(item.path, item.signedUrl);
    }
  }

  // Signed URLs let clients open files from the private buckets. Estimates
  // share the blueprints bucket (same {client_id}/{project_id}/ folder).
  const filePaths = [
    ...(projects ?? [])
      .map((p) => p.blueprint_path)
      .filter((p): p is string => Boolean(p)),
    ...estimatePathById.values(),
  ];

  const signedUrls = new Map<string, string>();
  if (filePaths.length > 0) {
    const { data } = await supabase.storage
      .from("blueprints")
      .createSignedUrls(filePaths, 60 * 60);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) {
        signedUrls.set(`blueprints:${item.path}`, item.signedUrl);
      }
    }
  }

  const filtered = Boolean(q || status || period || designerFilter);

  // Grouped team view: bucket the (already filtered) projects by their
  // designer. Owner first, then designers alphabetically (getOrgMembers'
  // order); projects whose designer left the org land in a trailing
  // "Former team member" group. Empty groups are skipped — the Account
  // page shows the full roster.
  const groups = groupedMode
    ? (() => {
        const byDesigner = new Map<string, Project[]>();
        for (const p of projects ?? []) {
          const list = byDesigner.get(p.client_id) ?? [];
          list.push(p);
          byDesigner.set(p.client_id, list);
        }
        const out: { key: string; label: string; projects: Project[] }[] = [];
        for (const m of members) {
          const list = byDesigner.get(m.user_id);
          if (!list?.length) continue;
          out.push({
            key: m.user_id,
            label: m.user_id === user.id ? "Your projects" : memberName(m),
            projects: list,
          });
          byDesigner.delete(m.user_id);
        }
        const orphaned = [...byDesigner.values()].flat();
        if (orphaned.length > 0) {
          out.push({
            key: "former",
            label: "Former team member",
            projects: orphaned,
          });
        }
        return out;
      })()
    : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-12 lg:py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-end gap-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/verde-vision-mark.png"
            alt="Verde Vision"
            className="w-16 shrink-0 object-contain sm:w-20"
          />
          <h1 className="font-serif text-4xl text-ink">
            {greetingForPhoenix()}, {displayName(user)}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-36 sm:w-40">
            <PeriodFilter />
          </div>
          <Link
            href="/dashboard/account"
            aria-label="Account"
            title="Account"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold uppercase tracking-wide text-paper shadow-[0_6px_16px_-6px_rgba(28,42,33,0.55)] ring-1 ring-inset ring-white/15 transition hover:bg-accent-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            {initials(user)}
          </Link>
        </div>
      </header>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <StatTile label="Total projects" value={String(totalCount)} />
        <StatTile label="Pending approval" value={String(pendingCount)} />
        <StatTile label="Estimate total" value={currency.format(estimateTotal)} />
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-serif text-2xl text-ink">
          {groupedMode ? "Team projects" : "Your projects"}
        </h2>
        <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
          <div className="sm:w-64">
            <SearchBar />
          </div>
          {groupedMode && (
            <div className="sm:w-48">
              <DesignerFilter
                options={members.map((m) => ({
                  value: m.user_id,
                  label: m.user_id === user.id ? "My projects" : memberName(m),
                }))}
              />
            </div>
          )}
          <div className="sm:w-44">
            <StatusFilter />
          </div>
        </div>
      </div>

      {error && (
        <p className="mt-4 text-sm text-clay">
          Could not load projects: {error.message}
        </p>
      )}

      {projects && projects.length === 0 && (
        <p className="mt-4 text-sm text-muted">
          {filtered
            ? "No projects match your search."
            : "No projects yet. Your Verde Vision team will add your project here soon."}
        </p>
      )}

      {(() => {
        const renderCard = (project: Project) => {
          const blueprintUrl = project.blueprint_path
            ? signedUrls.get(`blueprints:${project.blueprint_path}`)
            : undefined;
          const estimatePath = estimatePathById.get(project.id);
          const estimateUrl = estimatePath
            ? signedUrls.get(`blueprints:${estimatePath}`)
            : undefined;

          return (
            <section
              key={project.id}
              className="rounded-[14px] border border-edge bg-card p-5 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)] transition duration-200 ease-out hover:-translate-y-1 hover:shadow-[0_28px_55px_-28px_rgba(28,42,33,0.5)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 md:p-6"
            >
              <div className="flex flex-col gap-6 md:flex-row">
                <Link
                  href={`/dashboard/projects/${project.id}`}
                  className="block shrink-0 md:w-80 lg:w-96"
                  aria-label={`Open ${project.name}`}
                >
                  {(() => {
                    const path = coverPathById.get(project.id);
                    const url = path ? coverUrls.get(path) : undefined;
                    return url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={url}
                        alt=""
                        className="h-full min-h-52 w-full rounded-[10px] border border-rule object-cover"
                      />
                    ) : (
                      <NoPhotoSlot />
                    );
                  })()}
                </Link>

                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-serif text-[1.65rem] text-ink">
                        <Link
                          href={`/dashboard/projects/${project.id}`}
                          className="transition hover:text-accent-dim"
                        >
                          {project.name}
                        </Link>
                      </h3>
                      {project.description && (
                        <p className="mt-1 text-sm text-muted">
                          {project.description}
                        </p>
                      )}
                      <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                        <span className="flex items-center gap-1.5">
                          <svg
                            className="h-4 w-4 text-faint"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="4" y="5" width="16" height="16" rx="2" />
                            <path d="M4 10h16M8 3v4m8-4v4" />
                          </svg>
                          Created {longDate.format(new Date(project.created_at))}
                        </span>
                        {project.project_date && (
                          <span className="text-faint">
                            · Project date{" "}
                            {longDate.format(
                              new Date(`${project.project_date}T00:00:00`)
                            )}
                          </span>
                        )}
                      </p>
                    </div>
                    <StatusChip status={project.status} />
                  </div>

                  <dl className="mt-auto grid grid-cols-2 gap-x-6 gap-y-5 border-t border-rule pt-5 lg:grid-cols-3">
                    <StatCell label="Estimate">
                      {project.estimate_amount != null ? (
                        estimateUrl ? (
                          <a
                            href={estimateUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View estimate PDF"
                            className="font-mono text-sm font-semibold text-accent underline decoration-accent-soft underline-offset-4 transition hover:text-accent-bright"
                          >
                            {currency.format(project.estimate_amount)}
                          </a>
                        ) : (
                          <span className="font-mono text-sm font-semibold text-accent-dim">
                            {currency.format(project.estimate_amount)}
                          </span>
                        )
                      ) : (
                        "—"
                      )}
                    </StatCell>
                    <StatCell label="Blueprint">
                      {blueprintUrl ? (
                        <a
                          href={blueprintUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-accent underline decoration-accent-soft underline-offset-4 transition hover:text-accent-bright"
                        >
                          View PDF
                        </a>
                      ) : (
                        "—"
                      )}
                    </StatCell>
                    <StatCell label="3D plan">
                      {has3DPlan.has(project.id) ? (
                        <Link
                          href={`/viewer/${project.id}`}
                          className="font-semibold text-accent underline decoration-accent-soft underline-offset-4 transition hover:text-accent-bright"
                        >
                          Open viewer
                        </Link>
                      ) : (
                        "—"
                      )}
                    </StatCell>
                    <StatCell label="Share">
                      {(() => {
                        const tokens = shareTokensById.get(project.id);
                        return tokens ? (
                          <ShareLinkButtons
                            clientToken={tokens.client}
                            crewToken={tokens.crew}
                            compact
                          />
                        ) : (
                          "—"
                        );
                      })()}
                    </StatCell>
                    <StatCell label="Last updated">
                      {longDate.format(lastUpdated(project))}
                    </StatCell>
                  </dl>
                </div>
              </div>
            </section>
          );
        };

        if (!groups) {
          return (
            <div className="mt-7 space-y-7">{projects?.map(renderCard)}</div>
          );
        }

        return (
          <div className="mt-7 space-y-10">
            {groups.map((group) => {
              const subtotal = group.projects.reduce(
                (sum, p) => sum + (p.estimate_amount ?? 0),
                0
              );
              return (
                <section key={group.key}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule pb-2.5">
                    <h3 className="font-serif text-xl text-ink">
                      {group.label}
                      <span className="ml-2.5 text-sm text-faint">
                        {group.projects.length} project
                        {group.projects.length === 1 ? "" : "s"}
                      </span>
                    </h3>
                    <span className="font-mono text-sm tabular-nums text-muted">
                      {currency.format(subtotal)}
                    </span>
                  </div>
                  <div className="mt-5 space-y-7">
                    {group.projects.map(renderCard)}
                  </div>
                </section>
              );
            })}
          </div>
        );
      })()}

      {projects && projects.length > 0 && (
        <p className="mt-8 text-center text-xs text-faint">
          Showing {projects.length} of {totalCount} project
          {totalCount === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
