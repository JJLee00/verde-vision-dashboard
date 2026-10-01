import type { Scene } from "@/lib/viewer/scene";

/**
 * A still of the design, drawn server-side as SVG.
 *
 * The tile that opens the 3D viewer needs to SHOW the design, not describe
 * it — a card that says "walk through the plan" and shows nothing asks
 * somebody to take it on faith. Rendering a plan here rather than screenshotting
 * the viewer keeps it free: no JS, no headless browser, no stored image to go
 * stale when the design changes. It is the same geometry the viewer uses.
 */
export function PlanThumbnail({ scene }: { scene: Scene }) {
  const pad = Math.max(scene.radius * 0.12, 4);
  const r = scene.radius + pad;
  const [cx, cz] = scene.center;
  const view = `${cx - r} ${cz - r} ${r * 2} ${r * 2}`;

  const poly = (pts: [number, number][]) =>
    pts.map(([x, z]) => `${x},${z}`).join(" ");

  return (
    <svg
      viewBox={view}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {scene.hardscape.map((h, i) => (
        <polygon
          key={`h${i}`}
          points={poly(h.pts)}
          className="fill-ink/[0.07] stroke-ink/20"
          strokeWidth={r * 0.004}
        />
      ))}

      {scene.features.map((f, i) => (
        <polygon
          key={`f${i}`}
          points={poly(f.pts)}
          className="fill-ink/[0.05] stroke-ink/25"
          strokeWidth={r * 0.005}
        />
      ))}

      {scene.boundary.length > 2 && (
        <polygon
          points={poly(scene.boundary)}
          fill="none"
          className="stroke-ink/40"
          strokeWidth={r * 0.006}
        />
      )}

      {/* Canopies to scale, so the drawing reads as a planting plan rather
          than a scatter of identical dots. */}
      {scene.instances.map((p) => (
        <circle
          key={p.id}
          cx={p.x}
          cy={p.z}
          r={Math.max((p.meta.matureWidthFt * p.scale) / 2, r * 0.012)}
          className="fill-accent/25 stroke-accent/70"
          strokeWidth={r * 0.004}
        />
      ))}
    </svg>
  );
}
