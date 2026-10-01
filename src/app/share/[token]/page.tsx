import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadWebOrgBrand } from "@/lib/org-brand-web";
import { MAX_VIDEOS } from "@/lib/media";
import { VideoCarousel } from "./video-carousel";
import { LivingBlueprint } from "@/lib/viewer/LivingBlueprint";
import type { ProjectFileJSON } from "@/lib/viewer/types";

/**
 * What a homeowner opens.
 *
 * This link used to drop straight into the 3D viewer, which hands someone a
 * tool and no idea what they are looking at. It is a page now: the firm's
 * letterhead, the yard, and three ways in — the design, the plan, the
 * walkthrough.
 *
 * A GRID, sized to land on one screen on a laptop — a homeowner should see
 * everything on offer without scrolling for it. Identity first (name, who it
 * is for, when), then the ways in. The design tile carries an actual drawing
 * of the plan: a card that says "walk through the design" and shows nothing
 * is asking somebody to take it on faith. It is the REAL renderer in embed
 * mode — the same component and the same `embed` prop the dashboard's own
 * project page uses — rather than a still that could drift from it.
 *
 * On a phone it becomes one column in the same order, because that is where
 * a texted link gets opened.
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
      "id, client_id, org_id, name, customer_name, address, project_json, blueprint_path, cover_path, created_at"
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
  // Capped here too. A project uploaded before the limit existed can hold
  // more than three, and the client page is where the promise is kept.
  const videos = (videoRes.data ?? [])
    .map((v) => v.signedUrl)
    .filter((u): u is string => Boolean(u))
    .slice(0, MAX_VIDEOS);

  // Same order and separator the PDF letterhead uses.
  const contact = [brand.address, brand.phone, brand.email, brand.website]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v));

  // A full date, like the PDF's, rather than a month — it reads as a document
  // rather than a page that happens to know roughly when it was made.
  const documentDate = project.created_at
    ? new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date(project.created_at))
    : null;

  return (
    <main className="min-h-dvh bg-paper">
      {/* The estimate PDF's letterhead, in HTML. Deliberately the same
          composition rather than merely a similar one: logo, then the company
          in SANS BOLD (the PDF uses sans here, not the serif), then contact
          joined by middots, licence on its own line — and the document's name
          right-aligned in serif accent with its date beneath. A client who
          gets both should not be able to tell they were made by different
          machinery. */}
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-x-8 gap-y-4 px-4 py-6 sm:px-6 lg:px-12">
          <div className="min-w-0">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logoUrl}
                alt=""
                className="mb-3 h-11 w-auto max-w-[132px] object-contain"
              />
            ) : null}
            <p className="text-base font-bold text-ink">{brand.name}</p>
            {contact.length > 0 && (
              <p className="mt-1 text-xs text-muted">
                {contact.join("  ·  ")}
              </p>
            )}
            {brand.licenseNumber && (
              <p className="text-xs text-muted">
                License {brand.licenseNumber}
              </p>
            )}
          </div>

          <div className="text-right">
            <p className="font-serif text-[1.75rem] leading-none text-accent sm:text-[2rem]">
              Design
            </p>
            {documentDate && (
              <p className="mt-1.5 text-xs text-muted">{documentDate}</p>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-12">
        {/* Identity first, and the details directly UNDER the name. Right
            aligning them put a title and its own subtitle at opposite ends of
            a 1280px row, which is why they read as unrelated. */}
        <h1 className="font-serif text-[2rem] leading-tight text-ink sm:text-[2.4rem]">
          {project.name}
        </h1>
        {/* Deliberately NOT the contact email: it is the client's own, so
            showing it back adds nothing, and a link they forward would carry
            their address with it. Nor the headset sync stamp — that is ours. */}
        {(project.customer_name || project.address) && (
          <p className="mt-1 text-sm text-muted">
            {project.customer_name && <>Prepared for {project.customer_name}</>}
            {project.customer_name && project.address && " · "}
            {project.address}
          </p>
        )}

        {/* The RIGHT column sets the height and the design matches it, so the
            three tiles square up instead of the design towering over them.
            Its rows are explicitly equal; `min-h` is only a floor for the
            case where a project has neither a photo nor a video and the
            right column would otherwise collapse the design with it. */}
        <div className="mt-5 grid gap-4 lg:auto-rows-fr lg:grid-cols-3">
          {/* The design, given two thirds of the width and the drawing to
              match. It is what sells the job; the rest supports it. */}
          <Link
            href={`/share/${token}/design`}
            aria-label="Open the design"
            className="group relative block h-[20rem] overflow-hidden rounded-[14px] border border-edge bg-[#ebe0cb] transition hover:border-accent/40 hover:shadow-[0_28px_55px_-28px_rgba(28,42,33,0.5)] lg:col-span-2 lg:row-span-2 lg:h-auto lg:min-h-[26rem]"
          >
            <LivingBlueprint
              project={project.project_json as ProjectFileJSON}
              projectName={project.name}
              showPrices={false}
              embed
            />
            <span className="pointer-events-none absolute left-4 top-3.5 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-ink/50">
              Your design
            </span>
            <span className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 rounded-lg border border-rule-strong bg-card/85 px-3.5 py-2 text-sm font-semibold text-ink backdrop-blur transition group-hover:gap-2.5 group-hover:bg-card">
              Walk through it in 3D
              <span aria-hidden>→</span>
            </span>
          </Link>

          {coverUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl}
              alt=""
              className="aspect-[4/3] w-full rounded-[14px] border border-rule object-cover lg:aspect-auto lg:h-full lg:min-h-0 lg:self-stretch"
            />
          )}

          {project.blueprint_path && (
            <a
              href={`/share/${token}/blueprint`}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between gap-3 rounded-[14px] border border-edge bg-card px-5 py-4 transition hover:border-accent/40"
            >
              <span>
                <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
                  The plan
                </span>
                <span className="mt-0.5 block font-serif text-lg text-ink">
                  Blueprint PDF
                </span>
              </span>
              <span
                aria-hidden
                className="text-lg text-accent transition group-hover:translate-x-0.5"
              >
                →
              </span>
            </a>
          )}

          {videos.length > 0 && (
            <div className="min-h-[14rem] rounded-[14px] border border-edge bg-card p-4 lg:min-h-0">
              <VideoCarousel videos={videos} />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
