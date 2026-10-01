import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadWebOrgBrand } from "@/lib/org-brand-web";

/**
 * What a homeowner opens.
 *
 * This link used to drop straight into the 3D viewer, which hands someone a
 * tool and no idea what they are looking at. It is a page now: the firm's
 * letterhead, the yard, and three ways in — the design, the plan, the
 * walkthrough.
 *
 * Deliberately not dashboard-shaped. No sidebar, no nav, one column, one
 * job. It gets opened from a text message while someone stands in their
 * kitchen, so the phone layout is the one that has to be right and the wide
 * screen is the variation.
 *
 * No pricing anywhere, which is what let the client and crew links collapse
 * into one — both tokens resolve here. A proposal is a document the designer
 * sends, not a button on a page.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ShareLandingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!UUID_RE.test(token)) notFound();

  const supabase = createAdminClient();
  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, client_id, org_id, name, customer_name, project_json, blueprint_path, cover_path, created_at"
    )
    .or(`share_token.eq.${token},crew_token.eq.${token}`)
    .is("deleted_at", null)
    .maybeSingle();

  if (!project?.project_json) notFound();

  const videoPrefix = `${project.client_id}/${project.id}/videos`;
  const [brand, coverRes, videoRes] = await Promise.all([
    loadWebOrgBrand(supabase, project.org_id ?? null),
    project.cover_path
      ? supabase.storage
          .from("project-media")
          .createSignedUrl(project.cover_path, 60 * 60)
      : Promise.resolve({ data: null }),
    (async () => {
      const listing = await supabase.storage
        .from("project-media")
        .list(videoPrefix, { limit: 20, sortBy: { column: "name", order: "desc" } });
      const paths = (listing.data ?? []).map((o) => `${videoPrefix}/${o.name}`);
      if (paths.length === 0) return { data: [] };
      return supabase.storage
        .from("project-media")
        .createSignedUrls(paths, 60 * 60);
    })(),
  ]);

  const coverUrl = coverRes.data?.signedUrl ?? null;
  const videos = (videoRes.data ?? [])
    .map((v) => v.signedUrl)
    .filter((u): u is string => Boolean(u));

  const prepared = project.created_at
    ? new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
      }).format(new Date(project.created_at))
    : null;

  return (
    <main className="min-h-dvh bg-paper">
      {/* Letterhead — small and quiet. It says whose firm this is without
          turning into a banner competing with the yard below it. */}
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-5 py-5 sm:px-8">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoUrl}
              alt=""
              className="h-9 w-auto max-w-[160px] object-contain"
            />
          ) : null}
          <span className="font-serif text-lg text-ink">{brand.name}</span>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-5 pb-20 sm:px-8">
        {coverUrl && (
          // Their actual yard, first thing. The one asset guaranteed to be
          // theirs, and it makes the page read as made-for-them immediately.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt=""
            className="mt-6 aspect-[16/9] w-full rounded-[14px] border border-rule object-cover sm:mt-8"
          />
        )}

        <h1 className="mt-8 font-serif text-[2rem] leading-tight text-ink sm:text-[2.6rem]">
          {project.name}
        </h1>
        {(project.customer_name || prepared) && (
          <p className="mt-2 text-sm text-muted sm:text-base">
            {project.customer_name && <>Prepared for {project.customer_name}</>}
            {project.customer_name && prepared && " · "}
            {prepared}
          </p>
        )}

        {/* The design gets the weight. Three equal boxes would say these
            matter equally; the design is what sells the job and the other
            two support it. */}
        <Link
          href={`/share/${token}/design`}
          className="group mt-8 block rounded-[14px] border border-edge bg-card p-6 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[0_28px_55px_-28px_rgba(28,42,33,0.5)] motion-reduce:transition-none motion-reduce:hover:translate-0 sm:p-8"
        >
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
            Your design
          </p>
          <p className="mt-2 font-serif text-2xl text-ink sm:text-3xl">
            Walk through the plan in 3D
          </p>
          <p className="mt-2 max-w-lg text-sm text-muted">
            Every plant, placed where it will go. Spin it, look from the
            street, switch between the 3D view and the overhead plan.
          </p>
          <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-accent transition group-hover:gap-2.5">
            Open the design
            <span aria-hidden>→</span>
          </span>
        </Link>

        {(project.blueprint_path || videos.length > 0) && (
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            {project.blueprint_path && (
              <a
                href={`/share/${token}/blueprint`}
                target="_blank"
                rel="noopener noreferrer"
                className="group rounded-[14px] border border-edge bg-card p-5 transition hover:border-accent/40"
              >
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
                  The plan
                </p>
                <p className="mt-1.5 font-serif text-xl text-ink">
                  Blueprint PDF
                </p>
                <p className="mt-1.5 text-sm text-muted">
                  The measured drawing, to print or keep.
                </p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent transition group-hover:gap-2.5">
                  Open
                  <span aria-hidden>→</span>
                </span>
              </a>
            )}

            {videos.length > 0 && (
              <div className="rounded-[14px] border border-edge bg-card p-5">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
                  Walkthrough
                </p>
                <p className="mt-1.5 font-serif text-xl text-ink">
                  {videos.length === 1 ? "Video" : `${videos.length} videos`}
                </p>
                <div className="mt-3 flex flex-col gap-3">
                  {videos.map((url) => (
                    <video
                      key={url}
                      src={url}
                      controls
                      preload="metadata"
                      playsInline
                      className="w-full rounded-[10px] border border-rule bg-ink/[0.05]"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {(brand.phone || brand.email || brand.website) && (
          <footer className="mt-12 border-t border-rule pt-6">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
              Questions?
            </p>
            <p className="mt-2 font-serif text-lg text-ink">{brand.name}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              {brand.phone && (
                <a href={`tel:${brand.phone}`} className="hover:text-accent">
                  {brand.phone}
                </a>
              )}
              {brand.email && (
                <a href={`mailto:${brand.email}`} className="hover:text-accent">
                  {brand.email}
                </a>
              )}
              {brand.website && (
                <a
                  href={brand.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent"
                >
                  {brand.website.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>
            {brand.licenseNumber && (
              <p className="mt-2 text-xs text-faint">
                License {brand.licenseNumber}
              </p>
            )}
          </footer>
        )}
      </div>
    </main>
  );
}
