import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "./upload-form";
import { SignOutButton } from "./sign-out-button";

type Estimate = {
  id: string;
  file_name: string;
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
  plant_estimates: Estimate[];
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: projects, error } = await supabase
    .from("projects")
    .select(
      "id, name, description, status, created_at, project_date, estimate_amount, blueprint_path, plant_estimates(id, file_name, row_count, created_at)"
    )
    .order("created_at", { ascending: false })
    .returns<Project[]>();

  // Signed URLs let clients view their blueprint PDFs from the private bucket.
  const blueprintUrls = new Map<string, string>();
  for (const project of projects ?? []) {
    if (project.blueprint_path) {
      const { data } = await supabase.storage
        .from("blueprints")
        .createSignedUrl(project.blueprint_path, 60 * 60);
      if (data?.signedUrl) blueprintUrls.set(project.id, data.signedUrl);
    }
  }

  return (
    <main className="min-h-screen bg-paper">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-5">
          <div>
            <p className="text-[0.95rem] font-bold tracking-[0.18em] text-ink uppercase">
              Verde Vision
            </p>
            <p className="mt-0.5 text-xs text-muted">{user.email}</p>
          </div>
          <SignOutButton />
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-10">
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-clay">
          Client Dashboard
        </p>
        <h2 className="mt-2 font-serif text-4xl text-ink">Your projects</h2>

        {error && (
          <p className="mt-4 text-sm text-clay">
            Could not load projects: {error.message}
          </p>
        )}

        {projects && projects.length === 0 && (
          <p className="mt-4 text-sm text-muted">
            No projects yet. Your Verde Vision team will add your project here
            soon.
          </p>
        )}

        <div className="mt-8 space-y-7">
          {projects?.map((project) => (
            <section
              key={project.id}
              className="rounded-[14px] border border-edge bg-card p-7 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-serif text-2xl text-ink">
                    {project.name}
                  </h3>
                  {project.description && (
                    <p className="mt-1.5 text-sm text-muted">
                      {project.description}
                    </p>
                  )}
                </div>
                <span className="rounded-full border border-gold/40 bg-gold/10 px-3.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-gold">
                  {project.status}
                </span>
              </div>

              <dl className="mt-6 grid grid-cols-2 gap-5 border-t border-rule pt-5 sm:grid-cols-3">
                <div>
                  <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
                    Project date
                  </dt>
                  <dd className="mt-1.5 text-sm text-body">
                    {project.project_date
                      ? new Date(
                          `${project.project_date}T00:00:00`
                        ).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
                    Estimate
                  </dt>
                  <dd className="mt-1.5 font-mono text-sm font-semibold text-accent-dim">
                    {project.estimate_amount != null
                      ? currency.format(project.estimate_amount)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
                    Blueprint
                  </dt>
                  <dd className="mt-1.5 text-sm">
                    {blueprintUrls.has(project.id) ? (
                      <a
                        href={blueprintUrls.get(project.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-accent underline decoration-accent-soft underline-offset-4 transition hover:text-accent-bright"
                      >
                        View PDF
                      </a>
                    ) : (
                      <span className="text-body">—</span>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="mt-6 border-t border-rule pt-5">
                <h4 className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
                  Plant estimates
                </h4>
                {project.plant_estimates.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">
                    No estimates uploaded yet.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-rule text-sm">
                    {project.plant_estimates.map((estimate) => (
                      <li
                        key={estimate.id}
                        className="flex items-center justify-between py-2.5"
                      >
                        <span className="text-body">{estimate.file_name}</span>
                        <span className="font-mono text-xs text-faint">
                          {estimate.row_count != null
                            ? `${estimate.row_count} rows · `
                            : ""}
                          {new Date(estimate.created_at).toLocaleDateString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4">
                  <UploadForm projectId={project.id} userId={user.id} />
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
