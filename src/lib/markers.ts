// The three printed plates a site runs on, as the dashboard sees them.
//
// A project's alignment lives on three points, and each point is carried by a
// physical plate screwed to something that won't move. Coming back months
// later, the headset finds the plates and rebuilds the frame — which is why a
// reference photo of each one is worth as much as the design itself.
//
// The registrations ride inside project_json and the photos arrive as
// anchor_paths. The NOTES used to be read out of the registrations too, which
// was wrong in a way that was invisible: the app writes a registration's note
// once, when the plate is registered, so a note the designer typed afterwards
// never appeared here and the one on screen could be months stale. They have
// their own column now (migration 021, two-way), and the registration's copy
// is kept only as a fallback so nothing already on screen disappears.

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
  /**
   * What somebody wrote about where this plate is mounted — "garage frame,
   * 4 ft up". Editable here and in the headset.
   *
   * An empty string and null are different: empty means a note was written
   * and then cleared, which is a fact the headset needs in order to clear its
   * own copy. Null means nobody has ever written one.
   */
  note: string | null;
  /** When the note was last written, for the newer-wins comparison. */
  noteUpdatedAt: string | null;
  lockedDate: string | null;
  /** Signed URL for the reference photo, if there is one. */
  photoUrl: string | null;
};

/** One `anchor_notes` entry as the column stores it. */
export type AnchorNote = { text: string; updated_at: string | null };

export function buildSiteMarkers(
  registrations: MarkerRegistration[],
  photoUrlByStep: Partial<Record<AnchorStep, string>>,
  noteByStep: Partial<Record<AnchorStep, AnchorNote>> = {}
): SiteMarker[] {
  return ANCHOR_STEPS.map((step, pointIndex) => {
    const reg = registrations.find((r) => r.pointIndex === pointIndex) ?? null;
    const note = noteByStep[step];
    return {
      step,
      pointIndex,
      plateLabel: PLATE_LABELS[pointIndex],
      locked: reg != null,
      // The column wins whenever it has an entry at all, including an empty
      // one — a cleared note must not fall back to the stale copy inside the
      // registration, which is exactly the note that was cleared.
      note: note ? note.text : (reg?.note ?? null),
      noteUpdatedAt: note?.updated_at ?? null,
      lockedDate: reg?.registeredDate ?? null,
      photoUrl: photoUrlByStep[step] ?? null,
    };
  });
}

/** Pulls `anchor_notes` off a project row, defensively. */
export function anchorNotesFrom(
  raw: unknown
): Partial<Record<AnchorStep, AnchorNote>> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Partial<Record<AnchorStep, AnchorNote>> = {};
  for (const step of ANCHOR_STEPS) {
    const entry = (raw as Record<string, unknown>)[step];
    if (typeof entry !== "object" || entry === null) continue;
    const { text, updated_at: updatedAt } = entry as Record<string, unknown>;
    if (typeof text !== "string") continue;
    out[step] = {
      text,
      updated_at: typeof updatedAt === "string" ? updatedAt : null,
    };
  }
  return out;
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
