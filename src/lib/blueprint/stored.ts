// The house outline as a project stores it (migration 020).
//
// Written by the project page's House outline card, read back by that card
// and by /api/vision-pro/projects, which hands it to the headset. The
// headset decodes `candidate` with the same type it uses for /api/blueprint
// responses, so it MUST stay exactly that shape — minus the image bytes.

import type { BlueprintCandidate } from "./types";

export interface StoredBlueprint {
  version: 1;
  /**
   * Where the outline came from: "trace" when it was drawn on the
   * dashboard (trace.ts), or a parcel provider like "maricopa" for one
   * from the old county lookup.
   */
  provider: string;
  /**
   * The project address when the outline was made. The address can be
   * edited afterwards, and an outline made for the old one is the wrong
   * house — so the card compares the two and says so.
   */
  lookupAddress: string;
  /** The outline, imagery WITHOUT `orthoJpegBase64`. */
  candidate: BlueprintCandidate;
}

/** Reads the column defensively — a malformed row reads as "none". */
export function readStored(raw: unknown): StoredBlueprint | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<StoredBlueprint>;
  const candidate = value.candidate as Partial<BlueprintCandidate> | undefined;
  if (
    typeof value.provider !== "string" ||
    !candidate ||
    typeof candidate.apn !== "string" ||
    !Array.isArray(candidate.parcelXZ)
  ) {
    return null;
  }
  return value as StoredBlueprint;
}

/** Whether two typed addresses name the same place, ignoring case and spacing. */
export function sameAddress(a: string | null, b: string | null): boolean {
  const norm = (s: string | null) =>
    (s ?? "").toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}
