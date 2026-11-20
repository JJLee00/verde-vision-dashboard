"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { quatYaw } from "@/lib/blueprint/sheet";
import { xzMetersToRing } from "@/lib/blueprint/normalize";
import type { LatLng } from "@/lib/blueprint/types";
import { publishRevision } from "@/app/viewer/[id]/actions";
import {
  catalogOf,
  designChanged,
  designFromPlan,
  designOnPlan,
  newId,
  OFFERED_SURFACES,
  surfacePrice,
  surfaceRate,
} from "@/lib/site-plan/design";
import { localToGeo, type WalkFit } from "@/lib/site-plan/placed";
import { sheetDesign } from "@/lib/site-plan/sheet-design";
import { diffDesign, summarize } from "@/lib/versions";
import type { PlacedPlantJSON, ProjectFileJSON } from "@/lib/viewer/types";
import type { XZ } from "@/lib/site-plan/plan";
import {
  boundaryOutline,
  crosses,
  FEATURE_TYPES,
  isLineType,
  mainHouse,
  outlineOf,
  pathLength,
  polygonArea,
  withCurves,
  type FeatureType,
  type PlanDraft,
  type PlanFeature,
  type PlanFrame,
  type PlanImage,
  type PlanPlant,
  type PlanSurface,
  type SitePlan,
  type UnderlayKind,
} from "@/lib/site-plan/plan";
import { clearSitePlan, saveSitePlan } from "./actions";
import { AddressSearch, addressFor, HouseCheckLine, useHouseAddress } from "./address-search";
import { money, PlantActions, Schedule, SURFACE_TOOLS } from "./design-panels";
import { InventoryBar, keepSlots, savedSlots, seedSlots, SLOT_COUNT, type Slot } from "./inventory-bar";
import { displayName, PlanPatterns, SurfacePatterns, SurfaceSwatch, TypeSwatch } from "./drawing";
import { feetInches, squareUp, sqFt } from "./geometry";
import { LockIcon, UploadIcon } from "./icons";
import { readPlanFile } from "./plan-image";
import { plantRadiusM, type SheetPlant } from "./plants";
import {
  BOUNDARY_ID,
  duplicate,
  nameOf,
  plantOf,
  removeShape,
  setLocked,
  Sheet,
  shapeOf,
  sheetPlant,
  styleOf,
  surfaceTarget,
  toggleSmooth,
  withEdges,
  type Doc,
  type DrawTarget,
  type ImageTool,
  type Layer,
  type Placing,
  type SheetHandle,
  type Tool,
} from "./sheet";

// The 3D view is the viewer's renderer — big, and only wanted once asked for.
const Blueprint3D = dynamic(() => import("@/lib/viewer/LivingBlueprint").then((m) => m.LivingBlueprint), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-muted">Loading the 3D view…</p>,
});

/**
 * The site plan builder: find the property, lock the view, and trace
 * everything already in the yard over the photo — or over a plot plan
 * uploaded and scaled to size — fading it back as the plan fills in (the
 * Blueprint tab, named for the headset's Blueprint mode, in blueprint blue)
 * — then design on it, in 2D or 3D: plants and new surfaces from an
 * inventory bar like the headset's, each picked plant's buttons floating
 * beside it as the headset's do (the Design tab, in the usual green).
 * Saves itself a moment after each finished change.
 *
 * After the corner walk the yard's shapes belong to the headset and the
 * Site tab only shows them. The design can still change here: it's the
 * project's own design, shown back on the photo through the walk's fit, and
 * a change is published as a revision the headset pulls — the same way the
 * 3D viewer's editor publishes.
 */

/* ── Undo ────────────────────────────────────────────────────────── */

type History = { doc: Doc; past: Doc[]; future: Doc[]; merge: string | null };
type HistoryAction =
  // `merge`: a run of the same small edit (typing a name) is one step.
  | { type: "apply"; change: (d: Doc) => Doc; merge?: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; doc: Doc };

const MAX_UNDO = 100;

function history(h: History, a: HistoryAction): History {
  switch (a.type) {
    case "undo":
      if (h.past.length === 0) return h;
      return { doc: h.past[h.past.length - 1], past: h.past.slice(0, -1), future: [h.doc, ...h.future], merge: null };
    case "redo":
      if (h.future.length === 0) return h;
      return { doc: h.future[0], past: [...h.past, h.doc], future: h.future.slice(1), merge: null };
    case "reset":
      return { doc: a.doc, past: [], future: [], merge: null };
    case "apply": {
      const doc = a.change(h.doc);
      if (doc === h.doc) return h;
      if (a.merge && a.merge === h.merge) return { ...h, doc, future: [] };
      return { doc, past: [...h.past, h.doc].slice(-MAX_UNDO), future: [], merge: a.merge ?? null };
    }
  }
}

const docOf = (plan: SitePlan | null): Doc => ({
  boundary: plan?.boundary ?? [],
  ...(plan?.boundarySmooth ? { boundarySmooth: plan.boundarySmooth } : {}),
  ...(plan?.boundaryLocked ? { boundaryLocked: true } : {}),
  features: plan?.features ?? [],
  ...(plan?.mainHouseId ? { mainHouseId: plan.mainHouseId } : {}),
  plants: plan?.plants ?? [],
  surfaces: plan?.surfaces ?? [],
});

/** A design placed by the corner walk: the published design, in the
 *  yard's frame, and the walk's fit that carries the plan onto it. */
export type Walked = { project: ProjectFileJSON; fit: WalkFit };

/** The doc to start from. After the walk the design comes from the
 *  project, not the plan — the plan's own plants were placed by the walk
 *  and have lived in the project since. */
function startOf(initial: SitePlan | null, walked: Walked | null): Doc {
  const doc = docOf(initial);
  if (!walked) return doc;
  const { plants, surfaces } = designOnPlan(walked.project, walked.fit);
  return { ...doc, plants, surfaces };
}

/** A placement the catalog can't name, drawn on the plan where it stands. */
function otherOnPlan(p: PlacedPlantJSON, fit: WalkFit): SheetPlant {
  const [x, z] = localToGeo(fit, [p.positionX, p.positionZ]);
  return { id: p.id, model: p.plantModelName, scale: p.scaleX || 1, x, z, rotation: quatYaw(p) + fit.rotation };
}

/* ── The palette ─────────────────────────────────────────────────── */

/** What each thing is drawn with, the usual way first. */
const PALETTE: { target: FeatureType | "Boundary"; tools: Tool[] }[] = [
  { target: "House", tools: ["area", "rect"] },
  { target: "Boundary", tools: ["area", "rect"] },
  { target: "Pool", tools: ["area", "rect", "circle"] },
  { target: "Patio", tools: ["rect", "area", "circle"] },
  { target: "Driveway", tools: ["area", "rect"] },
  { target: "Walkway", tools: ["area", "rect"] },
  { target: "Deck", tools: ["rect", "area"] },
  { target: "Shed", tools: ["rect", "area"] },
  { target: "Garage", tools: ["rect", "area"] },
  { target: "Fence", tools: ["line"] },
  { target: "Retaining Wall", tools: ["line"] },
  { target: "AC Unit", tools: ["rect", "area"] },
  { target: "Fire Pit", tools: ["circle", "area"] },
  { target: "Other", tools: ["area", "rect", "circle"] },
];

const TOOL_LABEL: Record<Tool, string> = {
  select: "Select",
  area: "Shape",
  rect: "Rectangle",
  line: "Line",
  circle: "Circle",
  measure: "Measure",
  place: "Place",
};

/** Where a found address opens: the house and a typical lot around it. */
const AROUND_HOUSE = { cx: 0, cz: 0, halfWidth: 40, halfHeight: 30 };

const targetName = (t: DrawTarget) => (t === "Boundary" ? "Yard boundary" : t);

/** The Blueprint tab's ink: the dashboard's accent turned blueprint blue,
 *  so every selection, chip and button says which tab this is. */
const BLUEPRINT_INK = {
  "--accent": "#2d5a80",
  "--accent-bright": "#3a6d97",
  "--accent-dim": "#244a6a",
  "--accent-soft": "rgba(45, 90, 128, 0.2)",
} as React.CSSProperties;

/* ── The builder ─────────────────────────────────────────────────── */

export function SitePlanBuilder({
  projectId,
  projectName,
  initial,
  readOnly,
  designReadOnly,
  walked,
  prices,
  userId,
  planImageUrl,
  fixture,
}: {
  projectId: string;
  projectName: string;
  initial: SitePlan | null;
  /** Why the yard's shapes can't be changed here, or null when they can. */
  readOnly: string | null;
  /** Why the design can't be changed here, or null when it can. */
  designReadOnly: string | null;
  /** The design the corner walk placed, once it has. */
  walked: Walked | null;
  /** The org's grid prices, "plant_key|size" → price; a blank is $0. */
  prices: Record<string, number>;
  /** The signed-in designer: uploads go in their folder. */
  userId: string;
  /** A link to the uploaded plan's picture, when there is one. */
  planImageUrl: string | null;
  /** The dev fixture: everything works, nothing saves. */
  fixture: boolean;
}) {
  const router = useRouter();
  const sheet = useRef<SheetHandle | null>(null);
  const [{ doc, past, future }, dispatch] = useReducer(history, null, () => ({
    doc: startOf(initial, walked),
    past: [],
    future: [],
    merge: null,
  }));
  const apply = (change: (d: Doc) => Doc, merge?: string) => dispatch({ type: "apply", change, merge });

  const [origin, setOrigin] = useState<LatLng | null>(initial?.origin ?? null);
  const [frame, setFrame] = useState<PlanFrame | null>(initial?.frame ?? null);
  const [framing, setFraming] = useState(!initial && !readOnly);
  const [address, setAddress] = useState(initial?.lookupAddress ?? "");
  const [kind, setKind] = useState<UnderlayKind>(initial?.underlay.kind ?? "satellite");
  // The photo's strength on each tab: full for tracing, faint under the design.
  const [siteOpacity, setSiteOpacity] = useState(initial?.underlay.opacity ?? 1);
  const [designOpacity, setDesignOpacity] = useState(initial?.underlay.designOpacity ?? 0.35);
  const [planImage, setPlanImage] = useState<PlanImage | null>(initial?.planImage ?? null);
  const [imageUrl, setImageUrl] = useState<string | null>(planImageUrl);
  const [imageTool, setImageTool] = useState<ImageTool | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lotLines, setLotLines] = useState(false);
  const [grid, setGrid] = useState(true);
  const [gridSnap, setGridSnap] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [target, setTarget] = useState<DrawTarget>("House");
  const [toolFor, setToolFor] = useState<Partial<Record<DrawTarget, Tool>>>({});
  const [selected, setSelectedOnly] = useState<string | null>(null);
  // Plants picked together, two or more; `selected` is null while they are.
  const [group, setGroup] = useState<string[]>([]);
  /** Picks one thing (or nothing), letting go of any group. */
  const setSelected = (id: string | null) => {
    setGroup([]);
    setSelectedOnly(id);
  };
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // A placed plan opens on its design: the yard's shapes are the headset's.
  const [layer, setLayer] = useState<Layer>(
    walked || initial?.plants?.length || initial?.surfaces?.length ? "design" : "site"
  );
  const [view, setView] = useState<"plan" | "3d">("plan");
  const opacity = layer === "design" ? designOpacity : siteOpacity;
  const setOpacity = layer === "design" ? setDesignOpacity : setSiteOpacity;
  const [placing, setPlacing] = useState<Placing | null>(null);
  // The inventory bar: what this browser last kept on it, or else what
  // this design uses most.
  const [slots, setSlots] = useState<Slot[]>(() => seedSlots(doc.plants, doc.surfaces));
  const [active, setActive] = useState(0);
  useEffect(() => {
    const kept = savedSlots();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage exists only in the browser, after hydration
    if (kept) setSlots(kept);
  }, []);

  const siteEditable = !readOnly && !framing && frame != null;
  const designEditable = !designReadOnly && !framing && frame != null;
  const editable = view === "plan" && (layer === "site" ? siteEditable : designEditable);
  const empty = doc.features.length === 0 && doc.boundary.length === 0 && doc.plants.length === 0 && doc.surfaces.length === 0;

  /* ── Saving, before the walk ── */

  const draft: PlanDraft | null =
    origin && frame && !readOnly
      ? {
          provider: initial?.provider ?? "trace",
          lookupAddress: address,
          origin,
          frame,
          underlay: { kind, opacity: siteOpacity, designOpacity },
          ...(planImage ? { planImage } : {}),
          ...(initial?.mapOffset ? { mapOffset: initial.mapOffset } : {}),
          boundary: doc.boundary,
          ...(doc.boundarySmooth ? { boundarySmooth: doc.boundarySmooth } : {}),
          ...(doc.boundaryLocked ? { boundaryLocked: true } : {}),
          features: doc.features,
          ...(doc.mainHouseId ? { mainHouseId: doc.mainHouseId } : {}),
          ...(doc.plants.length ? { plants: doc.plants } : {}),
          ...(doc.surfaces.length ? { surfaces: doc.surfaces } : {}),
        }
      : null;
  const key = draft ? JSON.stringify(draft) : null;
  const [savedKey, setSavedKey] = useState(key);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Saves run one after another, so an older one can never land last.
  const chain = useRef<Promise<void>>(Promise.resolve());

  function save(k: string) {
    chain.current = chain.current.then(async () => {
      setSaving(true);
      const result = fixture
        ? ({ ok: true } as const)
        : await saveSitePlan(projectId, JSON.parse(k)).catch(
            (err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }) as const
          );
      setSaving(false);
      if (result.ok) {
        setSavedKey(k);
        setSaveError(null);
      } else setSaveError(result.error);
    });
    return chain.current;
  }

  // A moment after each finished change. Half-drawn shapes live in the
  // sheet, so they never reach here until they're finished.
  useEffect(() => {
    if (!key || key === savedKey) return;
    const timer = setTimeout(() => void save(key), 800);
    return () => clearTimeout(timer);
  });

  const dirty = key != null && key !== savedKey;

  /* ── Publishing, after the walk ── */

  // The design as published. It moves on with each publish here.
  const [base, setBase] = useState<ProjectFileJSON | null>(walked?.project ?? null);
  const fit = walked?.fit ?? null;
  const others = useMemo(() => (base && fit ? designOnPlan(base, fit).others : []), [base, fit]);
  // The published design read back through the plan, so "unchanged" means
  // what the Design tab would publish, not a rounding of it.
  const baseline = useMemo(() => {
    if (!base || !fit) return null;
    const d = designOnPlan(base, fit);
    return designFromPlan(base, fit, d.plants, d.surfaces, d.others);
  }, [base, fit]);
  const staged = useMemo(
    () => (base && fit ? designFromPlan(base, fit, doc.plants, doc.surfaces, others) : null),
    [base, fit, doc.plants, doc.surfaces, others]
  );
  const unpublished = baseline != null && staged != null && designChanged(baseline, staged);
  const changes = unpublished ? summarize(diffDesign(base, staged)) : null;
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<string | null>(null);

  async function publish() {
    if (!staged || !unpublished || publishing) return;
    setPublishing(true);
    const result = fixture
      ? ({ ok: true, revision: 0 } as const)
      : await publishRevision(projectId, staged).catch(
          (err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }) as const
        );
    setPublishing(false);
    if (!result.ok) return say(`Not published: ${result.error}`);
    setBase(staged);
    setPublished(fixture ? "Sample — nothing was published" : `Published as revision ${result.revision}`);
  }

  function discard() {
    if (!base || !fit) return;
    const { plants, surfaces } = designOnPlan(base, fit);
    apply((d) => ({ ...d, plants, surfaces }));
    setSelected(null);
  }

  useEffect(() => {
    if (!dirty && !unpublished) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, unpublished]);

  async function leave() {
    if (unpublished && !window.confirm("Leave without publishing? Your design changes will be lost.")) return;
    if (dirty && key) await save(key);
    router.push(`/dashboard/projects/${projectId}`);
  }

  /* ── Framing ── */

  function lock() {
    const box = sheet.current?.visibleBox();
    if (!box || !origin) return;
    if (empty) {
      // Nothing traced yet, so the plan can sit on the middle of the view.
      const [centre] = xzMetersToRing([[box.cx, box.cz]], origin);
      setOrigin(centre);
      sheet.current?.shift(-box.cx, -box.cz);
      setFrame({ ...box, cx: 0, cz: 0 });
    } else setFrame(box);
    setFraming(false);
    if (empty) pick("House");
  }

  /* ── What the tools make ── */

  function pick(t: FeatureType | "Boundary") {
    const tools = PALETTE.find((p) => p.target === t)!.tools;
    setImageTool(null);
    setTarget(t);
    setTool(toolFor[t] ?? tools[0]);
    setSelected(null);
  }

  function pickSurface(style: string) {
    const t = surfaceTarget(style);
    setTarget(t);
    setTool(toolFor[t] ?? SURFACE_TOOLS[0]);
    setPlacing(null);
    setSelected(null);
    if (view === "3d") {
      setView("plan");
      say("Surfaces are drawn on the plan.");
    }
  }

  function place(p: Placing | null) {
    setPlacing(p);
    setTool(p ? "place" : "select");
    if (p) setSelected(null);
  }

  /** The bar armed a slot: plant what's in it, or draw it. */
  function arm(index: number, slot: Slot) {
    setActive(index);
    if (slot?.kind === "plant") place({ key: slot.key, size: slot.size });
    else if (slot?.kind === "surface") pickSurface(slot.style);
  }

  function changeSlots(next: Slot[], nextActive?: number) {
    setSlots(next);
    keepSlots(next);
    if (nextActive != null) setActive(nextActive);
  }

  function changeView(v: "plan" | "3d") {
    setView(v);
    // The 3D view plants and picks; shapes and lengths are the plan's.
    if (v === "3d" && tool !== "select" && tool !== "place") onTool("select");
  }

  function onTool(t: Tool) {
    setTool(t);
    if (t !== "place") setPlacing(null);
    if (t !== "select") setImageTool(null);
  }

  function switchLayer(l: Layer) {
    if (l === layer) return;
    setLayer(l);
    setImageTool(null);
    setTool("select");
    setPlacing(null);
    setSelected(null);
  }

  function say(text: string) {
    setNotice(text);
    setTimeout(() => setNotice((n) => (n === text ? null : n)), 4000);
  }

  async function clearAll() {
    setConfirmClear(false);
    if (!fixture) {
      const result = await clearSitePlan(projectId);
      if (!result.ok) return say(result.error);
    }
    dispatch({ type: "reset", doc: docOf(null) });
    setOrigin(null);
    setFrame(null);
    setAddress("");
    setSelected(null);
    setTool("select");
    setLayer("site");
    setFraming(true);
    setSavedKey(null);
  }

  /* ── Picking plants together ── */

  /** The picked plants, as they are in the doc: a group, or one. */
  const chosen: PlanPlant[] =
    layer !== "design"
      ? []
      : group.length
        ? doc.plants.filter((p) => group.includes(p.id))
        : (plantOf(doc, selected) ? [plantOf(doc, selected)!] : []);

  /** Picks these plants: a group of two or more, or one. */
  function choose(ids: string[]) {
    const real = [...new Set(ids)].filter((id) => doc.plants.some((p) => p.id === id));
    if (real.length >= 2) {
      setSelectedOnly(null);
      setGroup(real);
    } else setSelected(real[0] ?? null);
  }

  /** Shift-click: a plant into the picked ones, or out of them. */
  function toggle(id: string) {
    const now = chosen.map((p) => p.id);
    choose(now.includes(id) ? now.filter((x) => x !== id) : [...now, id]);
  }

  const chosenIds = new Set(chosen.map((p) => p.id));

  /** Turns the picked plants 45°: a lone plant where it stands, a group
   *  round its middle, as a cluster. */
  function turnChosen(by = -Math.PI / 4) {
    if (!chosen.length) return;
    const [cx, cz] = chosen.length > 1 ? centreOf(chosen) : [0, 0];
    // A yaw turned down is clockwise on the sheet, which is the positions'
    // angle turned up (z runs down the screen).
    const [c, s] = [Math.cos(-by), Math.sin(-by)];
    apply((d) => ({
      ...d,
      plants: d.plants.map((p) => {
        if (!chosenIds.has(p.id)) return p;
        const at = chosen.length > 1 ? { x: cx + (p.x - cx) * c - (p.z - cz) * s, z: cz + (p.x - cx) * s + (p.z - cz) * c } : {};
        return { ...p, ...at, rotation: turned(p.rotation, by) };
      }),
    }));
  }

  /** Copies of the picked plants — a lone one beside itself, a group
   *  beside the group — picked in their place. */
  function duplicateChosen() {
    if (!chosen.length) return;
    if (chosen.length === 1) {
      const copy = duplicate(doc, chosen[0].id);
      if (copy) {
        apply(() => copy.doc);
        setSelected(copy.id);
      }
      return;
    }
    let [x0, x1] = [Infinity, -Infinity];
    for (const p of chosen) {
      const r = sheetPlant(p) ? plantRadiusM(sheetPlant(p)!) : 0.5;
      [x0, x1] = [Math.min(x0, p.x - r), Math.max(x1, p.x + r)];
    }
    const step = x1 - x0 + 0.3;
    const copies = chosen.map((p) => ({ ...p, id: newId(), x: p.x + step }));
    apply((d) => ({ ...d, plants: [...d.plants, ...copies] }));
    // Not `choose`: the copies aren't in the doc until the next render.
    setSelectedOnly(null);
    setGroup(copies.map((p) => p.id));
  }

  function deleteChosen() {
    if (!chosen.length) return;
    apply((d) => ({ ...d, plants: d.plants.filter((p) => !chosenIds.has(p.id)) }));
    setSelected(null);
  }

  function changeChosen(next: Pick<PlanPlant, "key" | "size">) {
    apply((d) => ({ ...d, plants: d.plants.map((p) => (chosenIds.has(p.id) ? { ...p, ...next } : p)) }));
  }

  /* ── An uploaded plot plan ── */

  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    if (uploading) return;
    setUploading(true);
    try {
      const read = await readPlanFile(file);
      const ext = read.blob.type === "image/png" ? "png" : read.blob.type === "image/webp" ? "webp" : "jpg";
      const path = `${fixture ? "fixture" : userId}/${projectId}/site-plan-${Date.now()}.${ext}`;
      const url = URL.createObjectURL(read.blob);
      if (!fixture) {
        const supabase = createClient();
        const { error } = await supabase.storage
          .from("project-media")
          .upload(path, read.blob, { contentType: read.blob.type || "image/png" });
        if (error) throw new Error(error.message);
      }
      // Until its scale is set, it covers most of the locked view.
      const f = frame ?? { cx: 0, cz: 0, halfWidth: 30, halfHeight: 30 };
      const scale = Math.min((f.halfWidth * 1.8) / read.w, (f.halfHeight * 1.8) / read.h);
      setPlanImage({ path, name: read.name, w: read.w, h: read.h, x: f.cx, z: f.cz, scale, rotation: 0, opacity: 0.85 });
      if (imageUrl?.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
      setImageUrl(url);
      // Traced instead of the photo; Satellite brings it back to line up against.
      setKind("none");
      setTool("select");
      setPlacing(null);
      setSelected(null);
      setImageTool("scale");
    } catch (err) {
      say(err instanceof Error ? err.message : "The plan couldn't be uploaded.");
    } finally {
      setUploading(false);
    }
  }

  function removeImage() {
    setPlanImage(null);
    setImageTool(null);
    if (kind === "none") setKind("satellite");
    if (imageUrl?.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
    setImageUrl(null);
  }

  function toggleImageTool(t: ImageTool) {
    if (imageTool === t) return setImageTool(null);
    setTool("select");
    setPlacing(null);
    setSelected(null);
    if (planImage?.hidden) setPlanImage({ ...planImage, hidden: undefined });
    setImageTool(t);
  }

  /* ── The address check, on the main house ── */

  const house = mainHouse(doc);
  const houseRing = house && origin && house.shape === "area" ? xzMetersToRing(outlineOf(house), origin) : [];
  const check = useHouseAddress(houseRing, address);

  /* ── The plants the sheet draws but never picks ── */

  const otherPlants = useMemo(() => (fit ? others.map((o) => otherOnPlan(o, fit)) : []), [others, fit]);

  /* ── The 3D view: the design as the headset will build it ── */

  const project3d = useMemo(
    () => (view !== "3d" ? null : (staged ?? sheetDesign(null, doc, projectName))),
    [view, staged, doc, projectName]
  );

  const status = walked
    ? null
    : readOnly
      ? null
      : fixture
        ? "Sample plan — nothing is saved"
        : saveError
          ? null
          : !draft
            ? null
            : saving || dirty
              ? "Saving…"
              : "Saved";

  const banner = layer === "site" ? readOnly : designReadOnly;

  /* ── The inventory bar, and designing in 3D ── */

  const armed = layer === "design" && (tool === "place" || (SURFACE_TOOLS.includes(tool) && styleOf(target) != null));

  // 1–7 arm the bar's slots, as the headset's sit under the hand; R turns
  // what's picked. A group's keys are all here, and in 3D Esc puts the bar
  // down and Delete takes the picked plant — on the plan, the sheet's own
  // keys look after one plant.
  useEffect(() => {
    if (layer !== "design" || !designEditable) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const here = chosen.length > 0 && (group.length > 0 || view === "3d");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d" && here) {
        e.preventDefault();
        duplicateChosen();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === "r" && chosen.length && tool === "select") {
        e.preventDefault();
        turnChosen(e.shiftKey ? Math.PI / 4 : -Math.PI / 4);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && here) {
        e.preventDefault();
        deleteChosen();
        return;
      }
      const n = Number(e.key);
      // Not while a shape is being drawn: its lengths are typed in digits.
      if (Number.isInteger(n) && n >= 1 && n <= SLOT_COUNT && (tool === "select" || tool === "place")) {
        const slot = slots[n - 1];
        if (!slot) return;
        e.preventDefault();
        arm(n - 1, slot);
        return;
      }
      if (view !== "3d") return;
      // The plan's own keys stand down while it's hidden: these are 3D's.
      if (e.key === "Escape") {
        if (tool !== "select") onTool("select");
        else setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // The 3D view hands back the project's own metres: the plan's before the
  // walk, the yard's after it — which the walk's fit lays back on the plan.
  const fromLocal = (x: number, z: number): XZ => (fit ? localToGeo(fit, [x, z]) : [x, z]);
  const planting = tool === "place" && placing ? catalogOf(placing) : null;
  const designer3d =
    layer === "design" && designEditable
      ? {
          placing: planting ? { model: planting.size.modelName, scale: planting.size.heightMultiplier } : null,
          onPlace: (x: number, z: number) => {
            if (!placing) return;
            const [px, pz] = fromLocal(x, z);
            const plant = { id: newId(), key: placing.key, size: placing.size, x: px, z: pz, rotation: Math.random() * Math.PI * 2 - Math.PI };
            apply((d) => ({ ...d, plants: [...d.plants, plant] }));
          },
          onMove: (moves: { id: string; x: number; z: number }[]) => {
            // A plant already in the yard isn't the design's to move: the
            // view puts it back.
            const to = new Map(moves.filter((m) => doc.plants.some((q) => q.id === m.id)).map((m) => [m.id, fromLocal(m.x, m.z)]));
            if (!to.size) return;
            apply((d) => ({
              ...d,
              plants: d.plants.map((q) => {
                const at = to.get(q.id);
                return at ? { ...q, x: at[0], z: at[1] } : q;
              }),
            }));
          },
          onAnchor: placeActions,
        }
      : null;

  // The picked plants' buttons, by them in 3D. The view says where they are
  // on screen as it moves, and the row follows without a re-render.
  const anchorRef = useRef<HTMLDivElement>(null);
  function placeActions(at: { x0: number; y0: number; x1: number; y1: number } | null) {
    const el = anchorRef.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    if (!at) {
      el.style.visibility = "hidden";
      return;
    }
    const h = el.offsetHeight || 104;
    const floor = box.clientHeight - 116;
    let top = at.y1 + 12;
    if (top + h > floor) top = at.y0 - 12 - h;
    el.style.left = `${Math.min(box.clientWidth - 160, Math.max(160, (at.x0 + at.x1) / 2))}px`;
    el.style.top = `${Math.max(56, Math.min(floor - h, top))}px`;
    el.style.visibility = "visible";
  }

  const actions =
    chosen.length && designEditable ? (
      <PlantActions
        key={chosen.map((p) => p.id).join()}
        plants={chosen}
        prices={prices}
        onChange={changeChosen}
        onTurn={() => turnChosen()}
        onDuplicate={duplicateChosen}
        onDelete={deleteChosen}
      />
    ) : null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-paper text-ink" style={layer === "site" ? BLUEPRINT_INK : undefined}>
      {/* ── Top bar, underlined in the tab's colour ── */}
      <header className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule bg-card px-4 py-2 shadow-[inset_0_-2px_0_var(--accent)]">
        <button
          type="button"
          onClick={() => void leave()}
          className="text-sm font-semibold text-muted transition hover:text-ink"
        >
          ← {projectName}
        </button>
        <span className="text-faint">/</span>
        <Tabs
          value={layer}
          options={[
            { value: "site", label: "Blueprint" },
            { value: "design", label: "Design" },
          ]}
          onChange={switchLayer}
          disabled={framing}
        />

        <div className="min-w-[220px] max-w-[420px] flex-1">
          {framing && empty ? (
            origin && (
              <AddressSearch
                initialQuery={address}
                onFound={(hit, query) => {
                  setOrigin({ lat: hit.lat, lng: hit.lng });
                  setAddress(addressFor(hit, query));
                  sheet.current?.fit(AROUND_HOUSE);
                }}
              />
            )
          ) : (
            <p className="truncate text-sm text-muted">{address || "No address"}</p>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {/* Hidden, not removed, in 3D: the bar keeps its height, so the
              2D/3D switch below it never jumps. */}
          <div className={`contents ${view === "3d" ? "invisible" : ""}`} inert={view === "3d"}>
            <Segmented
              value={kind}
              options={[
                { value: "satellite", label: "Satellite" },
                { value: "map", label: "Map" },
                { value: "none", label: "None" },
              ]}
              onChange={setKind}
            />
            <label className={`flex items-center gap-2 text-xs text-muted ${kind === "none" ? "opacity-40" : ""}`}>
              Photo
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(opacity * 100)}
                disabled={kind === "none"}
                onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                className="w-24 accent-[var(--accent)]"
                aria-label="Photo opacity"
                title={layer === "design" ? "The photo's strength on the Design tab" : "The photo's strength on the Blueprint tab"}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={lotLines} onChange={(e) => setLotLines(e.target.checked)} className="accent-[var(--accent)]" />
              Lot lines
            </label>
            <span className="h-5 w-px bg-rule" aria-hidden />
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} className="accent-[var(--accent)]" />
              Grid
            </label>
            <label className={`flex items-center gap-1.5 text-xs text-muted ${grid ? "" : "opacity-40"}`}>
              <input
                type="checkbox"
                checked={grid && gridSnap}
                disabled={!grid}
                onChange={(e) => setGridSnap(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              Snap to grid
            </label>
          </div>
          {!readOnly && framing && (
            <button
              type="button"
              disabled={!origin}
              onClick={lock}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              Lock view
            </button>
          )}
          {walked ? (
            <PublishBar
              changes={changes}
              published={published}
              publishing={publishing}
              canPublish={!designReadOnly}
              onPublish={() => void publish()}
              onDiscard={discard}
            />
          ) : (
            <span className="w-36 text-right text-xs">
              {saveError ? (
                <span className="text-clay" title={saveError}>
                  Not saved: {saveError}
                </span>
              ) : (
                <span className="text-faint">{status}</span>
              )}
            </span>
          )}
        </div>
      </header>

      {banner && <p className="border-b border-rule bg-gold/15 px-4 py-2 text-sm text-body">{banner}</p>}

      <div className="relative flex min-h-0 flex-1">
        <svg width={0} height={0} className="absolute" aria-hidden>
          <PlanPatterns />
          <SurfacePatterns />
        </svg>

        {/* 2D or 3D: one spot on both tabs — centred on the window left of the
          list, not on the sheet, which the Blueprint panel narrows. */}
        {!framing && frame != null && (
          <div className="absolute left-[calc((100%-18rem)/2)] top-3 z-20 -translate-x-1/2">
            <div role="tablist" aria-label="View" className="flex rounded-full border border-rule-strong bg-card/95 p-1 shadow-md">
              {(["plan", "3d"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => changeView(v)}
                  className={`min-w-16 rounded-full px-5 py-1.5 text-sm font-semibold transition ${
                    view === v ? "bg-ink text-paper" : "text-body hover:text-ink"
                  }`}
                >
                  {v === "plan" ? "2D" : "3D"}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Left: what to draw. The design plants from the bar instead. ── */}
        {layer === "site" && (
          <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-rule bg-card">
            {(planImage || (siteEditable && !walked)) && (
              <div className="border-b border-rule px-3 pb-3 pt-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Plot plan</p>
                {planImage && imageUrl ? (
                  <>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-body" title={planImage.name}>
                        {planImage.name}
                      </span>
                      <label className="flex items-center gap-1 text-xs text-muted">
                        <input
                          type="checkbox"
                          checked={!planImage.hidden}
                          onChange={(e) => setPlanImage({ ...planImage, hidden: e.target.checked ? undefined : true })}
                          className="accent-[var(--accent)]"
                        />
                        Show
                      </label>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      value={Math.round(planImage.opacity * 100)}
                      disabled={!!planImage.hidden}
                      onChange={(e) => setPlanImage({ ...planImage, opacity: Number(e.target.value) / 100 })}
                      className="mt-1 w-full accent-[var(--accent)] disabled:opacity-40"
                      aria-label="Plot plan strength"
                    />
                    <p className={`text-[11px] ${planImage.scaled ? "text-muted" : "font-semibold text-clay"}`}>
                      {planImage.scaled ? "Scale set from a length on it." : "Scale not set yet — set it before tracing."}
                    </p>
                    {siteEditable && (
                      <>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <ToolButton on={imageTool === "scale"} onClick={() => toggleImageTool("scale")} title="Click both ends of a length you know, then type it">
                            Set scale
                          </ToolButton>
                          <ToolButton on={imageTool === "align"} onClick={() => toggleImageTool("align")} title="Move, size and turn it over the photo">
                            Line up
                          </ToolButton>
                          <ToolButton on={imageTool === "north"} onClick={() => toggleImageTool("north")} title="Follow its north arrow, so north is up">
                            Set north
                          </ToolButton>
                        </div>
                        <div className="mt-2 flex gap-3 text-xs font-semibold">
                          <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="text-muted hover:text-ink">
                            {uploading ? "Reading…" : "Replace"}
                          </button>
                          <button type="button" onClick={removeImage} className="text-muted hover:text-clay">
                            Remove
                          </button>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={!siteEditable || uploading}
                      onClick={() => fileRef.current?.click()}
                      className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-rule-strong px-3 py-2 text-sm font-semibold text-body transition hover:border-accent hover:text-accent disabled:opacity-40"
                    >
                      <UploadIcon size={16} />
                      {uploading ? "Reading…" : "Upload a plot plan"}
                    </button>
                    <p className="mt-1.5 text-[11px] leading-snug text-faint">
                      A PDF or picture — a survey, a builder&apos;s plot plan, a sketch. Trace over it instead of the photo.
                    </p>
                  </>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                    e.target.value = "";
                  }}
                />
              </div>
            )}
            <div className="flex gap-1 border-b border-rule p-2">
              <ToolButton on={tool === "select"} onClick={() => onTool("select")} title="Select (V)">
                Select
              </ToolButton>
              <ToolButton on={tool === "measure"} onClick={() => onTool("measure")} title="Measure (M)">
                Measure
              </ToolButton>
            </div>
            <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-faint">Draw</p>
            {!siteEditable && !readOnly && (
              <p className="px-3 pb-2 text-xs text-muted">
                {origin ? "Lock the view to start tracing." : "Find the property first."}
              </p>
            )}
            <ul className={`pb-3 ${siteEditable ? "" : "pointer-events-none opacity-40"}`}>
              {PALETTE.map(({ target: t, tools }) => {
                const on = siteEditable && tool !== "select" && tool !== "measure" && target === t;
                return (
                  <li key={t}>
                    <button
                      type="button"
                      onClick={() => pick(t)}
                      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition ${
                        on ? "bg-accent/10 font-semibold text-ink" : "text-body hover:bg-card-hover"
                      }`}
                    >
                      {t === "Boundary" ? <BoundarySwatch /> : <TypeSwatch type={t} />}
                      {targetName(t)}
                      {t === "Boundary" && doc.boundary.length >= 3 && <span className="ml-auto text-[10px] text-faint">redraw</span>}
                    </button>
                    {on && tools.length > 1 && (
                      <div className="flex gap-1 px-3 pb-2 pl-10">
                        {tools.map((x) => (
                          <button
                            key={x}
                            type="button"
                            onClick={() => {
                              setTool(x);
                              setToolFor((m) => ({ ...m, [t]: x }));
                            }}
                            className={`rounded px-1.5 py-0.5 text-[11px] font-semibold transition ${
                              tool === x ? "bg-accent text-white" : "text-muted hover:text-ink"
                            }`}
                          >
                            {TOOL_LABEL[x]}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-auto border-t border-rule px-3 py-3 text-[11px] leading-relaxed text-faint">
              Type a length while drawing (42, 42.5, 42&apos;6) and press Enter. Hold Option to turn snapping off.
              Space-drag pans.
            </p>
          </aside>
        )}

        {/* ── The sheet ── */}
        <main className="relative min-w-0 flex-1">
          <Sheet
            handle={sheet}
            doc={doc}
            apply={(change) => apply(change)}
            undo={() => dispatch({ type: "undo" })}
            redo={() => dispatch({ type: "redo" })}
            canUndo={past.length > 0}
            canRedo={future.length > 0}
            selected={selected}
            onSelect={setSelected}
            group={layer === "design" ? group : []}
            onToggle={designEditable ? toggle : undefined}
            onBox={designEditable ? (ids) => choose([...chosen.map((p) => p.id), ...ids]) : undefined}
            actions={actions}
            image={planImage && imageUrl ? { plan: planImage, url: imageUrl } : null}
            imageTool={imageTool}
            onImage={setPlanImage}
            onImageTool={setImageTool}
            tool={tool}
            onTool={onTool}
            target={target}
            onDrawn={(id) => {
              setSelected(id);
              setTool("select");
            }}
            editable={editable}
            origin={origin}
            frame={framing ? null : frame}
            initialBox={frame}
            underlay={{ kind, opacity }}
            lotLines={lotLines}
            mapOffset={initial?.mapOffset ?? null}
            framing={framing && origin != null}
            onFrame={setFrame}
            grid={grid}
            gridSnap={gridSnap}
            layer={layer}
            placing={placing}
            others={otherPlants}
            chrome={layer === "design" ? "design" : "full"}
          />
          {project3d && (
            <div className="absolute inset-0 bg-[#ebe0cb]">
              <Blueprint3D
                project={project3d}
                projectName={projectName}
                priceOverrides={prices}
                showPrices={false}
                embed
                interactive
                editing={layer === "design"}
                selectedId={chosen.length === 1 ? chosen[0].id : null}
                selectedIds={chosen.length > 1 ? chosen.map((p) => p.id) : undefined}
                onSelectInstance={(id, add) => {
                  // Shift-click: another plant picked as well; on bare
                  // ground, nothing changes.
                  if (add && designEditable) {
                    if (id && doc.plants.some((q) => q.id === id)) toggle(id);
                    return;
                  }
                  setSelected(id && doc.plants.some((q) => q.id === id) ? id : null);
                }}
                designer={designer3d}
              />
              <div
                ref={anchorRef}
                className="absolute z-10 -translate-x-1/2"
                style={{ left: 0, top: 0, visibility: "hidden" }}
              >
                {actions}
              </div>
              <p className="pointer-events-none absolute bottom-[116px] left-3 rounded-md bg-card/90 px-2.5 py-1 text-xs text-muted shadow-sm">
                {planting
                  ? `Click the ground to plant ${planting.plant.name} — again for each one. Esc when you're done.`
                  : designer3d
                    ? "Drag to orbit, shift-drag to pan, scroll to zoom. Drag a plant to move it; shift-click to pick several."
                    : "Look around: drag to orbit, shift-drag to pan, scroll to zoom."}
              </p>
            </div>
          )}
          {layer === "design" && !framing && frame != null && (
            <>
              {!designEditable && !designReadOnly && (
                <p className="absolute bottom-[112px] left-1/2 z-20 -translate-x-1/2 rounded-md bg-card/95 px-3 py-1.5 text-xs text-muted shadow">
                  Lock the view on the Blueprint tab first.
                </p>
              )}
              <InventoryBar
                slots={slots}
                onSlots={changeSlots}
                active={active}
                armed={armed}
                onArm={arm}
                onEdit={() => onTool("select")}
                measuring={view === "plan" ? tool === "measure" : null}
                onMeasure={() => onTool(tool === "measure" ? "select" : "measure")}
                surfaceTool={tool}
                onSurfaceTool={(x) => {
                  setTool(x);
                  setToolFor((m) => ({ ...m, [target]: x }));
                }}
                canUndo={past.length > 0}
                canRedo={future.length > 0}
                onUndo={() => dispatch({ type: "undo" })}
                onRedo={() => dispatch({ type: "redo" })}
                prices={prices}
                editable={designEditable}
              />
            </>
          )}
          {!origin && !readOnly && (
            <div className="absolute inset-0 flex items-start justify-center bg-paper/60 pt-[14vh]">
              <div className="w-[min(520px,90%)] rounded-xl border border-rule bg-card p-6 shadow-lg">
                <h2 className="font-serif text-2xl">Find the property</h2>
                <p className="mt-1 text-sm text-muted">
                  Search the address, frame the yard, and lock the view. Then trace what&apos;s already there — the
                  house, the lot, the pool, fences — over the photo.
                </p>
                <div className="mt-4">
                  <AddressSearch
                    initialQuery=""
                    onFound={(hit, query) => {
                      setOrigin({ lat: hit.lat, lng: hit.lng });
                      setAddress(addressFor(hit, query));
                      sheet.current?.fit(AROUND_HOUSE);
                    }}
                  />
                </div>
              </div>
            </div>
          )}
          {notice && (
            <p className="absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-md bg-clay px-3 py-1.5 text-xs font-semibold text-white shadow">
              {notice}
            </p>
          )}
        </main>

        {/* ── Right: what's on the plan ── */}
        <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-rule bg-card">
          {layer === "design" ? (
            <>
              {selected && doc.surfaces.some((x) => x.id === selected) && (
                <Selection
                  doc={doc}
                  selected={selected}
                  editable={designEditable}
                  apply={apply}
                  onSelect={setSelected}
                  say={say}
                  prices={prices}
                />
              )}
              <Schedule
                plants={doc.plants}
                surfaces={doc.surfaces}
                others={others.length}
                prices={prices}
                selected={selected}
                onSelect={(id) => {
                  setSelected(id);
                  if (tool !== "select") onTool("select");
                }}
              />
            </>
          ) : (
            <>
              <Selection
                doc={doc}
                selected={selected}
                editable={siteEditable}
                apply={apply}
                onSelect={setSelected}
                say={say}
                prices={prices}
              />
              <div className="px-4 pb-2 pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">On this plan</p>
                {house && houseRing.length > 0 && <HouseCheckLine check={check} typed={address} compact />}
              </div>
              {doc.features.length === 0 && doc.boundary.length < 3 ? (
                <p className="px-4 text-sm text-muted">Nothing traced yet.</p>
              ) : (
                <ul className="pb-3">
                  {doc.boundary.length >= 3 && (
                    <ListRow
                      on={selected === BOUNDARY_ID}
                      swatch={<BoundarySwatch />}
                      name="Yard boundary"
                      size={sqFt(polygonArea(boundaryOutline(doc)))}
                      locked={!!doc.boundaryLocked}
                      onClick={() => setSelected(BOUNDARY_ID)}
                    />
                  )}
                  {doc.features.map((f) => (
                    <ListRow
                      key={f.id}
                      on={selected === f.id}
                      swatch={<TypeSwatch type={f.type} />}
                      name={displayName(f)}
                      badge={f === house && doc.features.filter((x) => x.type === "House").length > 1 ? "walked" : undefined}
                      size={sizeOf(f)}
                      locked={!!f.locked}
                      onClick={() => setSelected(f.id)}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
          {!readOnly && (frame != null || !empty) && (
            <div className="mt-auto border-t border-rule px-4 py-3">
              {confirmClear ? (
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-body">{empty ? "Start again at a new address?" : "Clear the whole plan?"}</span>
                  <button type="button" onClick={() => void clearAll()} className="font-semibold text-clay">
                    Clear
                  </button>
                  <button type="button" onClick={() => setConfirmClear(false)} className="font-semibold text-muted">
                    Keep
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmClear(true)} className="text-sm font-semibold text-muted hover:text-clay">
                  {empty ? "Start over" : "Clear plan"}
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

const turned = (r: number, by: number) => Math.atan2(Math.sin(r + by), Math.cos(r + by));
const centreOf = (ps: { x: number; z: number }[]): XZ => [
  ps.reduce((t, p) => t + p.x, 0) / ps.length,
  ps.reduce((t, p) => t + p.z, 0) / ps.length,
];

/* ── Publishing a placed design ──────────────────────────────────── */

function PublishBar({
  changes,
  published,
  publishing,
  canPublish,
  onPublish,
  onDiscard,
}: {
  /** What publishing would send, in a line; null when nothing would. */
  changes: string | null;
  published: string | null;
  publishing: boolean;
  canPublish: boolean;
  onPublish: () => void;
  onDiscard: () => void;
}) {
  if (!changes) {
    return (
      <span className="max-w-64 text-right text-xs text-faint">
        {published ?? (canPublish ? "Changes reach the headset when you publish them" : null)}
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="max-w-56 truncate text-xs text-muted" title={changes}>
        {changes}
      </span>
      <button type="button" onClick={onDiscard} className="text-xs font-semibold text-muted transition hover:text-clay">
        Discard
      </button>
      <button
        type="button"
        onClick={onPublish}
        disabled={publishing || !canPublish}
        className="rounded-lg bg-accent px-3.5 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
      >
        {publishing ? "Publishing…" : "Publish changes"}
      </button>
    </div>
  );
}

/* ── The selected shape ──────────────────────────────────────────── */

function Selection({
  doc,
  selected,
  editable,
  apply,
  onSelect,
  say,
  prices,
}: {
  doc: Doc;
  selected: string | null;
  editable: boolean;
  apply: (change: (d: Doc) => Doc, merge?: string) => void;
  onSelect: (id: string | null) => void;
  say: (text: string) => void;
  prices: Record<string, number>;
}) {
  if (!selected) return null;
  const shape = shapeOf(doc, selected);
  if (!shape) return null;
  const boundary = selected === BOUNDARY_ID;
  const f = shape.feature ?? null;
  const sf = shape.surface ?? null;
  const circle = (f ?? sf)?.shape === "circle";
  const radius = (f ?? sf)?.radius ?? 0;
  const { pts: points, closed, locked } = shape;
  const ring = withCurves(points, shape.smooth, closed);
  const smoothed = !!shape.smooth?.some(Boolean);
  const houses = doc.features.filter((x) => x.type === "House" && x.shape !== "line");

  const update = (change: (f: PlanFeature) => PlanFeature, merge?: string) =>
    apply((d) => ({ ...d, features: d.features.map((x) => (x.id === selected ? change(x) : x)) }), merge);
  const updateSurface = (change: (s: PlanSurface) => PlanSurface) =>
    apply((d) => ({ ...d, surfaces: d.surfaces.map((x) => (x.id === selected ? change(x) : x)) }));

  function square() {
    const next = squareUp(points, closed);
    if (crosses(withCurves(next, shape!.smooth, closed), closed)) return say("Squaring this one would make its edges cross.");
    apply((d) => withEdges(d, selected!, next, shape!.smooth));
  }

  function remove() {
    if (locked) return say(`The ${nameOf(doc, selected!)} is locked. Unlock it to delete it.`);
    apply((d) => removeShape(d, selected!));
    onSelect(null);
  }

  // A shape changes type within its kind: a run stays a run.
  const types = f ? FEATURE_TYPES.filter((t) => isLineType(t) === (f.shape === "line")) : [];
  // A surface in a retired material keeps it until it's changed.
  const materials = sf
    ? [...OFFERED_SURFACES.map((x) => x.style), ...(OFFERED_SURFACES.some((x) => x.style === sf.style) ? [] : [sf.style])]
    : [];
  const area = circle ? Math.PI * radius ** 2 : closed ? polygonArea(ring) : 0;

  return (
    <section className="border-b border-rule px-4 py-4">
      <div className="flex items-center gap-2">
        {boundary ? <BoundarySwatch /> : sf ? <SurfaceSwatch style={sf.style} size={22} /> : <TypeSwatch type={f!.type} size={22} />}
        <h2 className="font-serif text-lg leading-tight">{boundary ? "Yard boundary" : sf ? sf.style : displayName(f!)}</h2>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {circle ? (
          <>
            <dt className="text-muted">Across</dt>
            <dd>{feetInches(radius * 2)}</dd>
            <dt className="text-muted">Area</dt>
            <dd>{sqFt(area)}</dd>
          </>
        ) : closed ? (
          <>
            <dt className="text-muted">Area</dt>
            <dd>{sqFt(area)}</dd>
            <dt className="text-muted">Around</dt>
            <dd>{feetInches(pathLength(ring, true))}</dd>
            <dt className="text-muted">Corners</dt>
            <dd>{points.length}</dd>
          </>
        ) : (
          <>
            <dt className="text-muted">Length</dt>
            <dd>{feetInches(pathLength(ring, false))}</dd>
          </>
        )}
        {sf && (
          <>
            <dt className="text-muted">Price</dt>
            <dd>
              {surfaceRate(sf.style, prices) > 0 ? (
                <>
                  {money(Math.round(surfacePrice(sf, prices)))}
                  <span className="text-xs text-muted"> at {money(surfaceRate(sf.style, prices))}/ft²</span>
                </>
              ) : (
                <span className="text-faint">Not priced</span>
              )}
            </dd>
          </>
        )}
      </dl>

      {editable && (
        <div className="mt-4 space-y-3">
          {f && (
            <label className="block text-xs font-semibold text-muted">
              Type
              <select
                value={f.type}
                onChange={(e) => {
                  const type = e.target.value as FeatureType;
                  update((x) => ({ ...x, type, ...(type === "Other" ? {} : { label: undefined }) }));
                }}
                className="mt-1 block w-full rounded-lg border border-rule-strong bg-card-hover px-2 py-1.5 text-sm font-normal text-ink"
              >
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          )}
          {sf && (
            <label className="block text-xs font-semibold text-muted">
              Material
              <select
                value={sf.style}
                onChange={(e) => updateSurface((x) => ({ ...x, style: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-rule-strong bg-card-hover px-2 py-1.5 text-sm font-normal text-ink"
              >
                {materials.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          )}
          {f?.type === "Other" && (
            <label className="block text-xs font-semibold text-muted">
              Name
              <input
                value={f.label ?? ""}
                maxLength={60}
                autoFocus={!f.label}
                placeholder="What is it? (Planter, Pergola…)"
                onChange={(e) => update((x) => ({ ...x, label: e.target.value }), `label:${f.id}`)}
                className="mt-1 block w-full rounded-lg border border-rule-strong bg-card-hover px-2 py-1.5 text-sm font-normal text-ink placeholder:text-faint"
              />
            </label>
          )}
          {f?.type === "House" && houses.length > 1 && (
            <label className="flex items-start gap-2 text-sm text-body">
              <input
                type="checkbox"
                checked={mainHouse(doc)?.id === f.id}
                onChange={() => apply((d) => ({ ...d, mainHouseId: f.id }))}
                className="mt-1 accent-[var(--accent)]"
              />
              <span>
                The house walked on site
                <span className="block text-xs text-muted">The headset places the plan by two of its corners.</span>
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <SmallButton
              onClick={() => apply((d) => setLocked(d, selected!, !locked))}
              title={locked ? "Unlock it to move or change it" : "Lock it so it can't be moved by accident"}
              on={locked}
            >
              <span className="flex items-center gap-1">
                <LockIcon open={!locked} size={13} />
                {locked ? "Unlock" : "Lock"}
              </span>
            </SmallButton>
            {!circle && !locked && (
              <SmallButton
                onClick={() => {
                  const next = toggleSmooth(doc, selected!);
                  const t = shapeOf(next, selected!)!;
                  if (crosses(withCurves(t.pts, t.smooth, t.closed), t.closed)) return say("Smoothing this one would make its edges cross.");
                  apply(() => next);
                }}
                title={smoothed ? "Make every corner sharp again" : "Curve the outline smoothly through its corners"}
                on={smoothed}
              >
                Smooth
              </SmallButton>
            )}
            {!circle && points.length >= 3 && !locked && (
              <SmallButton onClick={square} title="Turn nearly-square corners exactly square">
                Square corners
              </SmallButton>
            )}
            {(f || sf) && (
              <SmallButton
                onClick={() => {
                  const copy = duplicate(doc, selected!);
                  if (copy) {
                    apply(() => copy.doc);
                    onSelect(copy.id);
                  }
                }}
                title="Duplicate (⌘D)"
              >
                Duplicate
              </SmallButton>
            )}
            <SmallButton onClick={remove} title="Delete (⌫)" danger>
              Delete
            </SmallButton>
          </div>
          <p className="text-[11px] leading-relaxed text-faint">
            {locked
              ? "Locked: it can't be moved, reshaped or deleted until it's unlocked."
              : "Drag a corner to move it, a dot mid-edge to add one, the round handle to turn it. Smooth curves the outline through its corners — gentle ones; sharp turns stay sharp. Double-click a corner to switch it between smooth and sharp. Click a corner, then ⌫, to take it out."}
          </p>
        </div>
      )}
    </section>
  );
}

/* ── Small parts ─────────────────────────────────────────────────── */

function sizeOf(f: PlanFeature): string {
  if (f.shape === "circle") return `${feetInches((f.radius ?? 0) * 2)} across`;
  if (f.shape === "line") return feetInches(pathLength(outlineOf(f), false));
  return sqFt(polygonArea(outlineOf(f)));
}

function ListRow({
  on,
  swatch,
  name,
  size,
  badge,
  locked,
  onClick,
}: {
  on: boolean;
  swatch: React.ReactNode;
  name: string;
  size: string;
  badge?: string;
  locked: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-sm transition ${
          on ? "bg-accent/10 font-semibold text-ink" : "text-body hover:bg-card-hover"
        }`}
      >
        {swatch}
        <span className="min-w-0 flex-1 truncate">
          {name}
          {badge && <span className="ml-1.5 rounded bg-accent/15 px-1 py-px text-[10px] font-semibold text-accent">{badge}</span>}
        </span>
        {locked && (
          <span className="shrink-0 text-faint" title="Locked">
            <LockIcon size={13} />
          </span>
        )}
        <span className="shrink-0 text-xs text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
          {size}
        </span>
      </button>
    </li>
  );
}

function BoundarySwatch() {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden className="shrink-0">
      <rect x={2} y={2} width={14} height={14} fill="none" stroke="#1c2a21" strokeWidth={1.5} strokeDasharray="5 2 1.5 2" />
    </svg>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-rule-strong">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-xs font-semibold transition ${
            value === o.value ? "bg-ink text-paper" : "text-body hover:bg-card-hover"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The builder's two tabs: the yard as it is, and the design. */
function Tabs<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="tablist" className={`flex gap-1 ${disabled ? "pointer-events-none opacity-40" : ""}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`border-b-2 px-2 py-1 font-serif text-lg leading-tight transition ${
            value === o.value ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ToolButton({
  on,
  disabled = false,
  onClick,
  title,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-2 py-1 text-xs font-semibold transition disabled:opacity-30 ${
        on ? "bg-ink text-paper" : "text-body hover:bg-card-hover"
      }`}
    >
      {children}
    </button>
  );
}

function SmallButton({
  onClick,
  title,
  danger = false,
  on = false,
  children,
}: {
  onClick: () => void;
  title: string;
  danger?: boolean;
  on?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
        on
          ? "border-accent bg-accent/10 text-accent"
          : danger
            ? "border-rule-strong text-muted hover:border-clay hover:text-clay"
            : "border-rule-strong text-body hover:border-accent hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}
