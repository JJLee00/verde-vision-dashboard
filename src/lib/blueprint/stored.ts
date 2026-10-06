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
   * The address the outline was made for: what the card's search found
   * (or the project's address, for one from the old county lookup). Shown
   * on the card; may be empty if the designer panned to the house.
   */
  lookupAddress: string;
  /** The outline, imagery WITHOUT `orthoJpegBase64`. */
  candidate: BlueprintCandidate;
  /**
   * Where the Map view's footprints needed shifting to agree with the
   * satellite at this property (see trace.ts MapOffset). Dashboard-only —
   * never sent to the headset.
   */
  mapOffset?: { east: number; north: number };
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
