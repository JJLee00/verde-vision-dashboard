// The lot + house outline as a project stores it (migration 020).
//
// Written by the project page's House outline card, read back by that card
// and by /api/vision-pro/projects, which hands it to the headset. The
// headset decodes `candidate` with the same type it uses for /api/blueprint
// responses, so it MUST stay exactly that shape — minus the image bytes.

import type { BlueprintCandidate } from "./types";

export interface StoredBlueprint {
  version: 1;
  /** Which parcel provider answered, e.g. "maricopa". */
  provider: string;
  /**
   * The project address this lot was looked up from. The address can be
   * edited afterwards, and an outline picked for the old one is the wrong
   * house — so the card compares the two and says so.
   */
  lookupAddress: string;
  /** The enriched parcel, imagery WITHOUT `orthoJpegBase64`. */
  candidate: BlueprintCandidate;
}

/** Where a project's aerial tile lives in the project-media bucket. */
export function orthoPathFor(clientId: string, projectId: string): string {
  return `${clientId}/${projectId}/blueprint/ortho.jpg`;
}

/**
 * Splits an enriched candidate into what goes in the database and the JPEG
 * that goes to storage. The base64 never reaches the row: the row rides
 * along on every project-list request a headset makes.
 */
export function toStored(
  provider: string,
  lookupAddress: string,
  candidate: BlueprintCandidate
): { stored: StoredBlueprint; orthoJpeg: Buffer | null } {
  const imagery = candidate.imagery ?? null;
  const orthoJpeg =
    imagery?.orthoJpegBase64 ? Buffer.from(imagery.orthoJpegBase64, "base64") : null;
  let strippedImagery = imagery;
  if (imagery) {
    const { orthoJpegBase64: _bytes, ...rest } = imagery;
    void _bytes;
    strippedImagery = rest;
  }
  return {
    stored: {
      version: 1,
      provider,
      lookupAddress,
      candidate: { ...candidate, imagery: strippedImagery },
    },
    orthoJpeg,
  };
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
