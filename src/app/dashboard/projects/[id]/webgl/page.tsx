import { notFound } from "next/navigation";
import { WebGLPilot } from "./pilot";

// Dev-only: the 3D view's WebGL pilot, a yard of shrubs drawn by the canvas
// or by WebGL, to compare how each looks and runs. `?scene=sage` is a yard
// of Texas Sage; `?scene=one&m=Jojoba` one plant, close to; `&sel=1` its
// first plant selected (gold).

export const metadata = { title: "WebGL pilot — Verde Vision" };

export default async function WebGLPilotPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ n?: string; scene?: string; m?: string; sel?: string }>;
}) {
  const { id } = await params;
  if (id !== "fixture" || process.env.NODE_ENV !== "development") notFound();
  const { n, scene, m, sel } = await searchParams;
  return (
    <WebGLPilot
      count={Math.max(1, Math.min(200, Number(n) || 40))}
      scene={scene === "sage" || scene === "one" ? scene : "yard"}
      model={m ?? "TexasSage"}
      selected={sel === "1"}
    />
  );
}
