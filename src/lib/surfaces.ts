import catalog from "@/lib/catalog.json";
import type { HardscapeAreaJSON } from "@/lib/viewer/types";

// Surface pricing for the estimate — the traced areas (pavers, turf,
// decomposed granite…), billed per square foot rather than per container.
//
// The styles and both per-sq-ft prices are GENERATED from the app's
// HardscapeStyle (npm run gen:catalog reads HardscapeArea.swift), so a
// surface here bills exactly what the headset quotes for it. The headset has
// no surface price book yet; an office that wants a different number types
// over the row, and the resync leaves that price alone.

export type SurfaceStyle = {
  /** HardscapeStyle case name, e.g. "paver". */
  case: string;
  /** Its raw value — what project_json carries, e.g. "Paving Stones 081". */
  style: string;
  pricePerSqFt: number;
  laborPerSqFt: number;
};

const STYLES = (catalog as unknown as { surfaces?: SurfaceStyle[] }).surfaces ?? [];
const BY_RAW = new Map(STYLES.map((s) => [s.style, s]));
const BY_CASE = new Map(STYLES.map((s) => [s.case, s]));

/**
 * The style a saved area renders as, mirroring HardscapeStyle's lenient
 * decoder: "Pavers" is the paver style's pre-rename raw value, and anything
 * unrecognised (the retired "Pool") falls back to concrete — which is what
 * the headset drew and priced it as.
 */
export function surfaceStyle(raw: string): SurfaceStyle | null {
  return (
    BY_RAW.get(raw) ??
    (raw === "Pavers" ? BY_CASE.get("paver") : undefined) ??
    BY_CASE.get("concrete") ??
    null
  );
}

const SQ_FT_PER_SQ_M = 10.7639;

/**
 * Plan area in square feet: the shoelace formula on (x, z), the same
 * computation as HardscapeArea.areaSquareMeters. Fewer than three corners is
 * not an area, and the headset leaves those off its estimate too.
 */
export function surfaceSqFt(area: HardscapeAreaJSON): number {
  const v = area.vertices ?? [];
  if (v.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    sum += a.positionX * b.positionZ - b.positionX * a.positionZ;
  }
  return (Math.abs(sum) / 2) * SQ_FT_PER_SQ_M;
}
