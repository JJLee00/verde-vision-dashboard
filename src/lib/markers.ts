// The three printed plates a site runs on, as the dashboard sees them.
//
// A project's alignment lives on three points, and each point is carried by a
// physical plate screwed to something that won't move. Coming back months
// later, the headset finds the plates and rebuilds the frame — which is why a
// reference photo of each one is worth as much as the design itself.
//
// Everything here is read out of data the headset already syncs. The
// registrations ride inside project_json; the photos arrive as anchor_paths.
// Nothing new is stored.

/** What the app writes into project_json.markerRegistrations. */
export type MarkerRegistration = {
  markerID: string; // "A" … "F"
  registeredDate?: string;
  note?: string | null;
  /** Which of the three alignment points this plate carries: 0, 1, 2. */
  pointIndex?: number | null;
};

/**
 * The wire names for the three points, in order.
 *
 * These are a contract with the deployed app — AnchorPhotoStorage uploads
 * under exactly these keys and its own comment warns against renaming them —
 * so the index into this array IS the point index.
 */
export const ANCHOR_STEPS = ["origin", "first", "second"] as const;
export type AnchorStep = (typeof ANCHOR_STEPS)[number];

/**
 * The plates a site is issued, in point order.
 *
 * Fixed, not derived: MarkerPolicy.siteMarkerIDs is ["A", "B", "C"] and point
 * 1 is plate A by convention. The app can still recognise D–F and has artwork
 * for them, but no site is issued one — and the points carry these letters
 * even on a site running no plates at all, which is why the label does not
 * depend on anything having been registered.
 */
export const PLATE_LABELS = ["Plate A", "Plate B", "Plate C"] as const;

export type SiteMarker = {
  step: AnchorStep;
  pointIndex: number;
  /** "Plate A" — fixed by position, see PLATE_LABELS. */
  plateLabel: string;
  /**
   * Whether the headset has locked onto this plate for this project.
   *
   * Locking is the headset seeing the physical plate through image tracking
   * and writing its position into the project's permanent frame — which is
   * what makes it findable on a return visit. A PHOTO is not this: a photo
   * helps a person find the plate, a lock is the headset having measured it.
   */
  locked: boolean;
  note: string | null;
  lockedDate: string | null;
  /** Signed URL for the reference photo, if there is one. */
  photoUrl: string | null;
};

export function buildSiteMarkers(
  registrations: MarkerRegistration[],
  photoUrlByStep: Partial<Record<AnchorStep, string>>
): SiteMarker[] {
  return ANCHOR_STEPS.map((step, pointIndex) => {
    const reg = registrations.find((r) => r.pointIndex === pointIndex) ?? null;
    return {
      step,
      pointIndex,
      plateLabel: PLATE_LABELS[pointIndex],
      locked: reg != null,
      note: reg?.note ?? null,
      lockedDate: reg?.registeredDate ?? null,
      photoUrl: photoUrlByStep[step] ?? null,
    };
  });
}

/** Pulls the registrations out of a synced project_json, defensively. */
export function registrationsFrom(projectJson: unknown): MarkerRegistration[] {
  const raw = (projectJson as { markerRegistrations?: unknown } | null)
    ?.markerRegistrations;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is MarkerRegistration =>
      typeof r === "object" && r !== null && typeof (r as MarkerRegistration).markerID === "string"
  );
}
