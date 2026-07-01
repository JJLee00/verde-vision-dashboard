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
  plant_estimates: Estimate[];
};

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
      "id, name, description, status, created_at, plant_estimates(id, file_name, row_count, created_at)"
    )
    .order("created_at", { ascending: false })
    .returns<Project[]>();

  return (
    <main className="min-h-screen bg-stone-100">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-lg font-semibold text-stone-900">
              Verde Vision
            </h1>
            <p className="text-xs text-stone-500">{user.email}</p>
          </div>
          <SignOutButton />
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-8">
        <h2 className="text-xl font-semibold text-stone-900">Your projects</h2>

        {error && (
          <p className="mt-4 text-sm text-red-600">
            Could not load projects: {error.message}
          </p>
        )}

        {projects && projects.length === 0 && (
          <p className="mt-4 text-sm text-stone-500">
            No projects yet. Your Verde Vision team will add your project here
            soon.
          </p>
        )}

        <div className="mt-6 space-y-6">
          {projects?.map((project) => (
            <section
              key={project.id}
              className="rounded-2xl bg-white p-6 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-stone-900">
                    {project.name}
                  </h3>
                  {project.description && (
                    <p className="mt-1 text-sm text-stone-600">
                      {project.description}
                    </p>
                  )}
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
                  {project.status}
                </span>
              </div>

              <div className="mt-4">
                <h4 className="text-sm font-medium text-stone-700">
                  Plant estimates
                </h4>
                {project.plant_estimates.length === 0 ? (
                  <p className="mt-1 text-sm text-stone-500">
                    No estimates uploaded yet.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-stone-100 text-sm">
                    {project.plant_estimates.map((estimate) => (
                      <li
                        key={estimate.id}
                        className="flex items-center justify-between py-2"
                      >
                        <span className="text-stone-800">
                          {estimate.file_name}
                        </span>
                        <span className="text-xs text-stone-500">
                          {estimate.row_count != null
                            ? `${estimate.row_count} rows · `
                            : ""}
                          {new Date(estimate.created_at).toLocaleDateString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-4 border-t border-stone-100 pt-4">
                <UploadForm projectId={project.id} userId={user.id} />
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
