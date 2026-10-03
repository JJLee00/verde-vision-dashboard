"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/org";
import {
  BlueprintLookupError,
  enrichCandidate,
  findCandidates,
} from "@/lib/blueprint/lookup";
import { orthoPathFor, toStored } from "@/lib/blueprint/stored";

// The House outline card's server side: find the lot for the project's
// address, then trace the house on the one the designer confirms and store
// it on the project for the headset to pick up.
//
// Server actions, not a call to /api/blueprint: that route is keyed with the
// headset's API key, which must never reach a browser. These run as the
// signed-in designer, so the project row and the storage folder are guarded
// by the same RLS as every other edit on this page.

export type LotChoice = {
  apn: string;
  address: string;
  /** Parcel outline, metres from its centroid (x east, z south). */
  parcelXZ: [number, number][];
  lotSizeSqFt: number | null;
  livableAreaSqFt: number | null;
  constructionYear: number | null;
};

type Failure = { ok: false; error: string };

const MIGRATION_HINT = "Run migration-020 in Supabase before looking up lots.";

/**
 * The project, if this user may change it and it has an address to look up.
 *
 * Checked up front rather than left to RLS on the final write, because the
 * expensive part — the imagery fetch — happens before that write. A team
 * member who can see a project but not edit it should be told so, not spend
 * an imagery call and then fail.
 */
async function editableProject(
  projectId: string,
  { requireAddress = true }: { requireAddress?: boolean } = {}
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." } as const;

  const { data: project } = await supabase
    .from("projects")
    .select("id, client_id, address")
    .eq("id", projectId)
    .single();
  if (!project) return { error: "Project not found." } as const;

  const membership = await getMembership(supabase, user.id);
  if (project.client_id !== user.id && membership?.role !== "owner") {
    return {
      error: "Only the project's designer or the firm's owner can change its outline.",
    } as const;
  }

  const address = (project.address as string | null)?.trim() ?? "";
  if (requireAddress && !address) {
    return { error: "Add the property address in Edit details first." } as const;
  }
  return { supabase, project, address } as const;
}

function lookupFailure(err: unknown, address: string): Failure {
  if (err instanceof BlueprintLookupError) {
    if (err.status === 404) {
      return {
        ok: false,
        error: `No lot found for “${address}”. Auto Blueprint only covers Maricopa County so far — check the street number and spelling.`,
      };
    }
    return {
      ok: false,
      error: "The county parcel service didn't answer. Try again in a minute.",
    };
  }
  return {
    ok: false,
    error: err instanceof Error ? err.message : "Lot lookup failed.",
  };
}

/** Step 1: every lot matching the project's address. Fast, no imagery. */
export async function findLots(
  projectId: string
): Promise<{ ok: true; lots: LotChoice[] } | Failure> {
  const access = await editableProject(projectId);
  if ("error" in access) return { ok: false, error: access.error! };

  try {
    const list = await findCandidates(access.address);
    return {
      ok: true,
      lots: list.candidates.map((c) => ({
        apn: c.apn,
        address: c.address,
        parcelXZ: c.parcelXZ,
        lotSizeSqFt: c.attributes.lotSizeSqFt ?? null,
        livableAreaSqFt: c.attributes.livableAreaSqFt ?? null,
        constructionYear: c.attributes.constructionYear ?? null,
      })),
    };
  } catch (err) {
    return lookupFailure(err, access.address);
  }
}

/**
 * Step 2: trace the house on the confirmed lot and store it on the project.
 * Slow — two GeoTIFF decodes, ~10–15 s — hence the page's maxDuration.
 */
export async function pickLot(
  projectId: string,
  apn: string
): Promise<{ ok: true } | Failure> {
  const access = await editableProject(projectId);
  if ("error" in access) return { ok: false, error: access.error! };
  const { supabase, project, address } = access;

  let provider: string;
  let candidate;
  try {
    const list = await findCandidates(address);
    provider = list.provider;
    candidate = await enrichCandidate(list, apn, { includeImagery: true });
  } catch (err) {
    return lookupFailure(err, address);
  }

  // A server without the imagery key still answers — with the lot and a
  // warning instead of a house. Storing that would send the headset a bare
  // rectangle labelled as the office's pick, so refuse it here, where the
  // person who can fix the configuration is looking.
  if (candidate.warnings?.some((w) => /GOOGLE_SOLAR_API_KEY/.test(w.message))) {
    return {
      ok: false,
      error:
        "Aerial imagery isn't configured on this server (GOOGLE_SOLAR_API_KEY), so the house can't be traced.",
    };
  }

  const { stored, orthoJpeg } = toStored(provider, address, candidate);

  let orthoPath: string | null = null;
  if (orthoJpeg) {
    // Under the designer's folder even when the owner is the one picking —
    // the same single canonical spot as every other piece of project media.
    const path = orthoPathFor(project.client_id as string, projectId);
    const { error: uploadError } = await supabase.storage
      .from("project-media")
      .upload(path, orthoJpeg, { contentType: "image/jpeg", upsert: true });
    if (uploadError) {
      return { ok: false, error: `Couldn't store the aerial: ${uploadError.message}` };
    }
    orthoPath = path;
  }

  const { error } = await supabase
    .from("projects")
    .update({
      blueprint_payload: stored,
      blueprint_ortho_path: orthoPath,
      blueprint_fetched_at: new Date().toISOString(),
    })
    .eq("id", projectId);
  if (error) {
    return {
      ok: false,
      error: /blueprint_/.test(error.message) ? MIGRATION_HINT : error.message,
    };
  }

  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: true };
}

/**
 * Clears the outline from the project. A headset that already has it keeps
 * its copy — this stops it reaching any that don't, and frees the card to
 * look the lot up again.
 */
export async function removeHouseOutline(
  projectId: string
): Promise<{ ok: true } | Failure> {
  // No address is fine here — someone clearing the address and then the
  // outline is exactly the order you'd expect.
  const access = await editableProject(projectId, { requireAddress: false });
  if ("error" in access) return { ok: false, error: access.error! };
  const { supabase } = access;

  const { data: row } = await supabase
    .from("projects")
    .select("blueprint_ortho_path")
    .eq("id", projectId)
    .single();

  const { error } = await supabase
    .from("projects")
    .update({
      blueprint_payload: null,
      blueprint_ortho_path: null,
      blueprint_fetched_at: null,
    })
    .eq("id", projectId);
  if (error) {
    return {
      ok: false,
      error: /blueprint_/.test(error.message) ? MIGRATION_HINT : error.message,
    };
  }

  // Best effort: an orphaned tile costs half a megabyte, a failed removal of
  // it should not undo the clear the designer asked for.
  const path = (row as { blueprint_ortho_path?: string | null } | null)?.blueprint_ortho_path;
  if (path) await supabase.storage.from("project-media").remove([path]);

  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: true };
}
