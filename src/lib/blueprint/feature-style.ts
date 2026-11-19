// How each kind of feature is drawn on the blueprint: its outline colour,
// its label colour, and the pattern inside it. FeaturePatterns.swift
// (featureStyle) in the app, as data — so the PDF (src/lib/pdf/
// blueprint-pdf.ts) and the site plan builder draw from one definition and
// can't drift apart. Sizes are in sheet points; the builder scales them.

/** 0–1 per channel. */
export type RGB01 = [number, number, number];

export type FeatureFill =
  /** Parallel lines falling to the right at 45°, `spacing` apart. */
  | { kind: "lines"; color: RGB01; width: number; spacing: number }
  /** Rows of waves, `spacing` apart, `wavelength` long, `amplitude` high. */
  | { kind: "waves"; color: RGB01; width: number; spacing: number; wavelength: number; amplitude: number }
  /** A square grid of dots, `spacing` apart. */
  | { kind: "dots"; color: RGB01; radius: number; spacing: number };

export type FeatureStyle = { stroke: RGB01; label: RGB01; fill: FeatureFill };

const gray = (w: number): RGB01 => [w, w, w];

export function featureStyle(type: string): FeatureStyle {
  if (type === "House" || type === "Shed" || type === "Garage") {
    return {
      stroke: gray(0.15),
      label: gray(0.2),
      fill: { kind: "lines", color: gray(0.3), width: 0.35, spacing: 5 },
    };
  }
  if (type === "Pool") {
    return {
      stroke: [0.24, 0.48, 0.61],
      label: [0.2, 0.4, 0.52],
      fill: { kind: "waves", color: [0.35, 0.58, 0.71], width: 0.45, spacing: 4, wavelength: 8, amplitude: 0.8 },
    };
  }
  if (type === "Patio" || type === "Walkway" || type === "Driveway" || type === "Deck") {
    return {
      stroke: gray(0.4),
      label: gray(0.3),
      fill: { kind: "dots", color: gray(0.5), radius: 0.6, spacing: 6 },
    };
  }
  return {
    stroke: gray(0.4),
    label: gray(0.25),
    fill: { kind: "lines", color: gray(0.6), width: 0.35, spacing: 5 },
  };
}

export const cssColor = ([r, g, b]: RGB01, a = 1) =>
  `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
