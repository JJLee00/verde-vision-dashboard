"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { xzMetersToRing } from "@/lib/blueprint/normalize";
import type { LatLng } from "@/lib/blueprint/types";
import {
  crosses,
  FEATURE_TYPES,
  isLineType,
  mainHouse,
  pathLength,
  polygonArea,
  type FeatureType,
  type PlanDraft,
  type PlanFeature,
  type PlanFrame,
  type SitePlan,
  type UnderlayKind,
} from "@/lib/site-plan/plan";
import { clearSitePlan, saveSitePlan } from "./actions";
import { AddressSearch, addressFor, HouseCheckLine, useHouseAddress } from "./address-search";
import { displayName, PlanPatterns, TypeSwatch } from "./drawing";
import { feetInches, squareUp, sqFt } from "./geometry";
import { BOUNDARY_ID, duplicate, Sheet, type Doc, type DrawTarget, type SheetHandle, type Tool } from "./sheet";

/**
 * The site plan builder: find the property, lock the view, and trace
 * everything already in the yard over the photo, fading the photo back as
 * the plan fills in. Saves itself a moment after each finished change.
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
  features: plan?.features ?? [],
  ...(plan?.mainHouseId ? { mainHouseId: plan.mainHouseId } : {}),
});

/* ── The palette ─────────────────────────────────────────────────── */

/** What each thing is drawn with, the usual way first. */
const PALETTE: { target: DrawTarget; tools: Tool[] }[] = [
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
};

/** Where a found address opens: the house and a typical lot around it. */
const AROUND_HOUSE = { cx: 0, cz: 0, halfWidth: 40, halfHeight: 30 };

const targetName = (t: DrawTarget) => (t === "Boundary" ? "Yard boundary" : t);

/* ── The builder ─────────────────────────────────────────────────── */

export function SitePlanBuilder({
  projectId,
  projectName,
  initial,
  readOnly,
  fixture,
}: {
  projectId: string;
  projectName: string;
  initial: SitePlan | null;
  /** Why this plan can't be changed here, or null when it can. */
  readOnly: string | null;
  /** The dev fixture: everything works, nothing saves. */
  fixture: boolean;
}) {
  const router = useRouter();
  const sheet = useRef<SheetHandle | null>(null);
  const [{ doc, past, future }, dispatch] = useReducer(history, initial, (p) => ({
    doc: docOf(p),
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
  const [opacity, setOpacity] = useState(initial?.underlay.opacity ?? 1);
  const [lotLines, setLotLines] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [target, setTarget] = useState<DrawTarget>("House");
  const [toolFor, setToolFor] = useState<Partial<Record<DrawTarget, Tool>>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const editable = !readOnly && !framing && frame != null;
  const empty = doc.features.length === 0 && doc.boundary.length === 0;

  /* ── Saving ── */

  const draft: PlanDraft | null =
    origin && frame && !readOnly
      ? {
          provider: initial?.provider ?? "trace",
          lookupAddress: address,
          origin,
          frame,
          underlay: { kind, opacity },
          ...(initial?.mapOffset ? { mapOffset: initial.mapOffset } : {}),
          boundary: doc.boundary,
          features: doc.features,
          ...(doc.mainHouseId ? { mainHouseId: doc.mainHouseId } : {}),
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
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function leave() {
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

  function pick(t: DrawTarget) {
    const tools = PALETTE.find((p) => p.target === t)!.tools;
    setTarget(t);
    setTool(toolFor[t] ?? tools[0]);
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
    setFraming(true);
    setSavedKey(null);
  }

  /* ── The address check, on the main house ── */

  const house = mainHouse(doc);
  const houseRing = house && origin && house.shape === "area" ? xzMetersToRing(house.points, origin) : [];
  const check = useHouseAddress(houseRing, address);

  const status = readOnly
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

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-paper text-ink">
      {/* ── Top bar ── */}
      <header className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule bg-card px-4 py-2">
        <button
          type="button"
          onClick={() => void leave()}
          className="text-sm font-semibold text-muted transition hover:text-ink"
        >
          ← {projectName}
        </button>
        <span className="text-faint">/</span>
        <h1 className="font-serif text-lg">Site plan</h1>

        <div className="min-w-[280px] max-w-[460px] flex-1">
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
              className="w-28 accent-[var(--accent)]"
              aria-label="Photo opacity"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={lotLines} onChange={(e) => setLotLines(e.target.checked)} className="accent-[var(--accent)]" />
            Lot lines
          </label>
          {!readOnly &&
            (framing ? (
              <>
                {frame && (
                  <button type="button" onClick={() => setFraming(false)} className="text-sm font-semibold text-muted hover:text-ink">
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  disabled={!origin}
                  onClick={lock}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                >
                  Lock view
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setFraming(true);
                  setTool("select");
                  setSelected(null);
                }}
                className="rounded-lg border border-rule-strong px-3 py-1.5 text-sm font-semibold text-body transition hover:border-accent hover:text-accent"
              >
                Reframe
              </button>
            ))}
          <span className="w-36 text-right text-xs">
            {saveError ? (
              <span className="text-clay" title={saveError}>
                Not saved: {saveError}
              </span>
            ) : (
              <span className="text-faint">{status}</span>
            )}
          </span>
        </div>
      </header>

      {readOnly && <p className="border-b border-rule bg-gold/15 px-4 py-2 text-sm text-body">{readOnly}</p>}

      <div className="flex min-h-0 flex-1">
        {/* ── Left: what to draw ── */}
        <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-rule bg-card">
          <svg width={0} height={0} className="absolute" aria-hidden>
            <PlanPatterns />
          </svg>
          <div className="flex gap-1 border-b border-rule p-2">
            <ToolButton on={tool === "select"} onClick={() => setTool("select")} title="Select (V)">
              Select
            </ToolButton>
            <ToolButton on={tool === "measure"} onClick={() => setTool("measure")} title="Measure (M)">
              Measure
            </ToolButton>
            <ToolButton on={false} disabled={past.length === 0 || !editable} onClick={() => dispatch({ type: "undo" })} title="Undo (⌘Z)">
              ↶
            </ToolButton>
            <ToolButton on={false} disabled={future.length === 0 || !editable} onClick={() => dispatch({ type: "redo" })} title="Redo (⇧⌘Z)">
              ↷
            </ToolButton>
          </div>
          <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-faint">Draw</p>
          {!editable && !readOnly && (
            <p className="px-3 pb-2 text-xs text-muted">
              {origin ? "Lock the view to start tracing." : "Find the property first."}
            </p>
          )}
          <ul className={`pb-3 ${editable ? "" : "pointer-events-none opacity-40"}`}>
            {PALETTE.map(({ target: t, tools }) => {
              const on = editable && tool !== "select" && tool !== "measure" && target === t;
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
            Type a length while drawing (42, 42.5, 42&apos;6) and press Enter. Hold Option to turn snapping off. Space-drag
            pans.
          </p>
        </aside>

        {/* ── The sheet ── */}
        <main className="relative min-w-0 flex-1">
          <Sheet
            handle={sheet}
            doc={doc}
            apply={(change) => apply(change)}
            undo={() => dispatch({ type: "undo" })}
            redo={() => dispatch({ type: "redo" })}
            selected={selected}
            onSelect={setSelected}
            tool={tool}
            onTool={setTool}
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
          />
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
            <p className="absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-clay px-3 py-1.5 text-xs font-semibold text-white shadow">
              {notice}
            </p>
          )}
        </main>

        {/* ── Right: what's on the plan ── */}
        <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-rule bg-card">
          <Selection
            doc={doc}
            selected={selected}
            editable={editable}
            apply={apply}
            onSelect={setSelected}
            say={say}
          />
          <div className="px-4 pb-2 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">On this plan</p>
            {house && houseRing.length > 0 && <HouseCheckLine check={check} typed={address} compact />}
          </div>
          {empty ? (
            <p className="px-4 text-sm text-muted">Nothing traced yet.</p>
          ) : (
            <ul className="pb-3">
              {doc.boundary.length >= 3 && (
                <ListRow
                  on={selected === BOUNDARY_ID}
                  swatch={<BoundarySwatch />}
                  name="Yard boundary"
                  size={sqFt(polygonArea(doc.boundary))}
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
                  onClick={() => setSelected(f.id)}
                />
              ))}
            </ul>
          )}
          {!readOnly && !empty && (
            <div className="mt-auto border-t border-rule px-4 py-3">
              {confirmClear ? (
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-body">Clear the whole plan?</span>
                  <button type="button" onClick={() => void clearAll()} className="font-semibold text-clay">
                    Clear
                  </button>
                  <button type="button" onClick={() => setConfirmClear(false)} className="font-semibold text-muted">
                    Keep
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmClear(true)} className="text-sm font-semibold text-muted hover:text-clay">
                  Clear plan
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
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
}: {
  doc: Doc;
  selected: string | null;
  editable: boolean;
  apply: (change: (d: Doc) => Doc, merge?: string) => void;
  onSelect: (id: string | null) => void;
  say: (text: string) => void;
}) {
  if (!selected) return null;
  const boundary = selected === BOUNDARY_ID;
  const f = boundary ? null : doc.features.find((x) => x.id === selected);
  if (!boundary && !f) return null;
  const points = boundary ? doc.boundary : f!.points;
  const closed = boundary || f!.shape !== "line";
  const houses = doc.features.filter((x) => x.type === "House" && x.shape !== "line");

  const update = (change: (f: PlanFeature) => PlanFeature, merge?: string) =>
    apply((d) => ({ ...d, features: d.features.map((x) => (x.id === selected ? change(x) : x)) }), merge);

  function square() {
    const next = squareUp(points, closed);
    if (crosses(next, closed)) return say("Squaring this one would make its edges cross.");
    apply((d) => (boundary ? { ...d, boundary: next } : { ...d, features: d.features.map((x) => (x.id === selected ? { ...x, points: next } : x)) }));
  }

  function remove() {
    apply((d) =>
      boundary
        ? { ...d, boundary: [] }
        : { ...d, features: d.features.filter((x) => x.id !== selected), mainHouseId: d.mainHouseId === selected ? undefined : d.mainHouseId }
    );
    onSelect(null);
  }

  // A shape changes type within its kind: a run stays a run.
  const types = f ? FEATURE_TYPES.filter((t) => isLineType(t) === (f.shape === "line")) : [];

  return (
    <section className="border-b border-rule px-4 py-4">
      <div className="flex items-center gap-2">
        {boundary ? <BoundarySwatch /> : <TypeSwatch type={f!.type} size={22} />}
        <h2 className="font-serif text-lg leading-tight">{boundary ? "Yard boundary" : displayName(f!)}</h2>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {f?.shape === "circle" ? (
          <>
            <dt className="text-muted">Across</dt>
            <dd>{feetInches((f.radius ?? 0) * 2)}</dd>
            <dt className="text-muted">Area</dt>
            <dd>{sqFt(Math.PI * (f.radius ?? 0) ** 2)}</dd>
          </>
        ) : closed ? (
          <>
            <dt className="text-muted">Area</dt>
            <dd>{sqFt(polygonArea(points))}</dd>
            <dt className="text-muted">Around</dt>
            <dd>{feetInches(pathLength(points, true))}</dd>
            <dt className="text-muted">Corners</dt>
            <dd>{points.length}</dd>
          </>
        ) : (
          <>
            <dt className="text-muted">Length</dt>
            <dd>{feetInches(pathLength(points, false))}</dd>
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
            {f?.shape !== "circle" && points.length >= 3 && (
              <SmallButton onClick={square} title="Turn nearly-square corners exactly square">
                Square corners
              </SmallButton>
            )}
            {f && (
              <SmallButton
                onClick={() => {
                  const copy = duplicate(doc, f.id);
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
            Drag a corner to move it, a dot on an edge to add one, the round handle to turn it. Click a corner, then ⌫,
            to take it out.
          </p>
        </div>
      )}
    </section>
  );
}

/* ── Small parts ─────────────────────────────────────────────────── */

function sizeOf(f: PlanFeature): string {
  if (f.shape === "circle") return `${feetInches((f.radius ?? 0) * 2)} across`;
  if (f.shape === "line") return feetInches(pathLength(f.points, false));
  return sqFt(polygonArea(f.points));
}

function ListRow({
  on,
  swatch,
  name,
  size,
  badge,
  onClick,
}: {
  on: boolean;
  swatch: React.ReactNode;
  name: string;
  size: string;
  badge?: string;
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
  children,
}: {
  onClick: () => void;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-lg border border-rule-strong px-2.5 py-1 text-xs font-semibold transition ${
        danger ? "text-muted hover:border-clay hover:text-clay" : "text-body hover:border-accent hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}
