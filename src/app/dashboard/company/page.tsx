import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/org";
import { CompanyForm, type CompanyProfile } from "./company-form";

// Company profile: what goes on every document the dashboard sends out.
//
// The estimate PDF (and the blueprint after it) print under the
// LANDSCAPER's business, not Verde Vision's — their client should see their
// brand. Verde Vision keeps the small mark in the footer.
//
// Org-level and owner-only, matching migration-007: `organizations` updates
// are already restricted to owners, so these columns inherit that with no
// new policy. Designers see the profile read-only — it's useful to know what
// your proposals say even if you can't change it.

export const metadata = { title: "Company — Verde Vision" };

const BLANK: CompanyProfile = {
  name: "",
  logoPath: null,
  logoUrl: null,
  phone: "",
  email: "",
  address: "",
  website: "",
  licenseNumber: "",
  terms: "",
};

export default async function CompanyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getMembership(supabase, user.id);

  // No org means a pre-007 account or a user created outside the invite
  // flow. Nothing to brand, and nothing useful to offer them here.
  if (!membership) {
    return (
      <Shell>
        <p className="mt-8 max-w-xl text-sm text-muted">
          Your account isn&apos;t part of a company yet, so there&apos;s no
          profile to edit. Ask whoever invited you to add you to the team.
        </p>
      </Shell>
    );
  }

  // The branding columns arrive with migration-015; the name predates it.
  // Split selects so the page still renders before that migration runs.
  const [nameRes, brandRes] = await Promise.all([
    supabase
      .from("organizations")
      .select("name")
      .eq("id", membership.orgId)
      .maybeSingle(),
    supabase
      .from("organizations")
      .select("logo_path, phone, email, address, website, license_number, terms")
      .eq("id", membership.orgId)
      .maybeSingle(),
  ]);

  const schemaReady = !brandRes.error;
  const brand = brandRes.data;

  // org-assets is a public bucket — a logo is printed on documents that get
  // emailed, shared by link and handed over on paper. Nothing private there.
  let logoUrl: string | null = null;
  if (brand?.logo_path) {
    logoUrl = supabase.storage
      .from("org-assets")
      .getPublicUrl(brand.logo_path).data.publicUrl;
  }

  const profile: CompanyProfile = {
    ...BLANK,
    name: nameRes.data?.name ?? "",
    logoPath: brand?.logo_path ?? null,
    logoUrl,
    phone: brand?.phone ?? "",
    email: brand?.email ?? "",
    address: brand?.address ?? "",
    website: brand?.website ?? "",
    licenseNumber: brand?.license_number ?? "",
    terms: brand?.terms ?? "",
  };

  return (
    <Shell>
      {!schemaReady && (
        <div className="mt-6 max-w-2xl rounded-[14px] border border-gold/40 bg-gold/[0.07] p-5">
          <h2 className="font-serif text-lg text-ink">
            Waiting on migration 015
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            The branding columns aren&apos;t in this database yet. Run{" "}
            <code className="rounded bg-ink/[0.07] px-1.5 py-0.5 font-mono text-[0.78rem]">
              supabase/migration-015-estimate-builder.sql
            </code>{" "}
            and reload — everything below is live the moment it lands.
          </p>
        </div>
      )}

      <CompanyForm
        orgId={membership.orgId}
        initial={profile}
        canEdit={schemaReady && membership.role === "owner"}
        isOwner={membership.role === "owner"}
        schemaReady={schemaReady}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-clay">
        Company
      </p>
      <h1 className="mt-2 font-serif text-4xl text-ink">
        Your business on paper
      </h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        This is the letterhead on every estimate you send — and on the
        blueprints once those print from here too.
      </p>
      {children}
    </div>
  );
}
