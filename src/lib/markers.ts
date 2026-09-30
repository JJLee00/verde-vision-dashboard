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

/** What a designer calls each point out loud. */
export const POINT_LABELS = ["Point 1", "Point 2", "Point 3"] as const;

/**
 * All three, always. Two plates can produce a rigid frame, and that is the
 * problem: a fit over two points absorbs every error except the distance
 * between them, so a plate knocked 30cm sideways still reports a ~2mm
 * residual while the frame has yawed more than a degree. Three plates give
 * the fit something to disagree with.
 */
export const REQUIRED_PLATES = 3;

export type SiteMarker = {
  step: AnchorStep;
  pointIndex: number;
  pointLabel: string;
  /** The plate carrying this point, if one has been registered. */
  plateID: string | null;
  note: string | null;
  registeredDate: string | null;
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
      pointLabel: POINT_LABELS[pointIndex],
      plateID: reg?.markerID ?? null,
      note: reg?.note ?? null,
      registeredDate: reg?.registeredDate ?? null,
      photoUrl: photoUrlByStep[step] ?? null,
    };
  });
}

/** Can this project be re-aligned from its plates on a return visit? */
export function realignable(markers: SiteMarker[]): boolean {
  return markers.filter((m) => m.plateID).length >= REQUIRED_PLATES;
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
