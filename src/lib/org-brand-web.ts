// The landscaper's letterhead, for a web page rather than a PDF.
//
// lib/pdf/doc.ts already has an OrgBrand for the proposal, but it downloads
// the logo into a Buffer because pdfkit embeds bytes. A page just needs a
// URL, and `org-assets` is public (migration 016), so this is the cheaper
// shape rather than a second download per render.

import type { SupabaseClient } from "@supabase/supabase-js";

export type WebOrgBrand = {
  name: string;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  website: string | null;
  licenseNumber: string | null;
};

const BLANK: WebOrgBrand = {
  name: "Verde Vision",
  logoUrl: null,
  phone: null,
  email: null,
  address: null,
  website: null,
  licenseNumber: null,
};

/**
 * Always resolves. A client looking at their yard must never meet an error
 * page because a firm hasn't filled in its phone number — the worst case is
 * an unbranded page, which is what they had before this existed.
 */
export async function loadWebOrgBrand(
  supabase: SupabaseClient,
  orgId: string | null
): Promise<WebOrgBrand> {
  if (!orgId) return BLANK;

  // Split like the PDF loader does: a database that hasn't run migration-016
  // has the name but none of the branding columns, and the name alone is
  // still worth having on the page.
  const [nameRes, brandRes] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    supabase
      .from("organizations")
      .select("logo_path, phone, email, address, website, license_number")
      .eq("id", orgId)
      .maybeSingle(),
  ]);

  const brand = brandRes.data;
  let logoUrl: string | null = null;
  if (brand?.logo_path) {
    const { data } = supabase.storage
      .from("org-assets")
      .getPublicUrl(brand.logo_path);
    logoUrl = data?.publicUrl ?? null;
  }

  return {
    name: nameRes.data?.name || BLANK.name,
    logoUrl,
    phone: brand?.phone ?? null,
    email: brand?.email ?? null,
    address: brand?.address ?? null,
    website: brand?.website ?? null,
    licenseNumber: brand?.license_number ?? null,
  };
}
