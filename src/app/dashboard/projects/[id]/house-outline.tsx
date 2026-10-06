"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StoredBlueprint } from "@/lib/blueprint/stored";
import type { LatLng } from "@/lib/blueprint/types";
import { sameAddress } from "@/lib/blueprint/stored";
import { geocodeAddress, type GeocodeHit } from "@/lib/blueprint/esri";
import {
  ringAreaSqFt,
  TRACE_PROVIDER,
  tracedOutlineFrom,
  type TracedOutline,
} from "@/lib/blueprint/trace";
import { removeHouseOutline, saveTracedOutline } from "./house-outline-actions";
import { TraceMap, type MapView, type Shape, type ShapeKind, type Shapes } from "./trace-map";

/**
 * The house outline the headset will walk, traced by the designer on the
 * aerial at a desk.
 *
 * This used to be a county lookup plus an automatic trace of the roof from
 * Solar imagery, which only ever covered Maricopa County. Tracing by hand
 * works at any address with imagery, and the headset receives the same
 * outline either way: on site, Blueprint opens on the corner walk — walk to
 * two of these corners and the outline drops into the yard.
 */
export function HouseOutline({
  projectId,
  address,
  outline,
  ready,
  disabled,
}: {
  projectId: string;
  address: string | null;
  outline: { stored: StoredBlueprint; fetchedAt: string | null } | null;
  /** False until migration-020 has been run. */
  ready: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (!ready) {
    return (
      <p className="text-sm text-muted">
        Run migration-020 in Supabase and house outlines can be traced here.
      </p>
    );
  }

  const stored = outline?.stored ?? null;
  const addressChanged = stored != null && !sameAddress(stored.lookupAddress, address);

  if (editing && address) {
    return (
      <TraceEditor
        address={address}
        initial={stored ? tracedOutlineFrom(stored) : null}
        onCancel={() => setEditing(false)}
        onSave={async (traced) => {
          const result = await saveTracedOutline(projectId, traced);
          if (result.ok) {
            setEditing(false);
            startTransition(() => router.refresh());
          }
          return result;
        }}
      />
    );
  }

  async function remove() {
    setRemoving(true);
    setError(null);
    const result = await removeHouseOutline(projectId);
    if (!result.ok) setError(result.error);
    else startTransition(() => router.refresh());
    setRemoving(false);
  }

  return (
    <div>
      {stored ? (
        <SavedOutline stored={stored} fetchedAt={outline?.fetchedAt ?? null} />
      ) : !address ? (
        <p className="text-sm text-muted">
          Add the property address with <span className="font-semibold">Edit details</span>{" "}
          and the house can be traced here, so the headset arrives on site with
          the outline already in hand.
        </p>
      ) : (
        <p className="text-sm text-muted">
          Find <span className="text-body">{address}</span> on the aerial and
          click around the roof, corner by corner. The headset picks the outline
          up on its next sync — on site, walk to two of its corners and it drops
          into the yard.
        </p>
      )}

      {addressChanged && (
        <p className="mt-4 rounded-lg border border-gold/40 bg-gold/10 px-3.5 py-2.5 text-sm text-gold">
          Traced for “{stored!.lookupAddress}”. The project&apos;s address has
          changed since — check the outline is on the right house.
        </p>
      )}
      {error && <p className="mt-4 text-sm text-clay">{error}</p>}

      {!disabled && address && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={removing}
            onClick={() => {
              setError(null);
              setEditing(true);
            }}
            className={
              stored
                ? "rounded-lg border border-rule-strong px-4 py-2 text-sm font-semibold text-body transition hover:border-accent hover:text-accent disabled:opacity-50"
                : "rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-paper transition hover:bg-accent-bright disabled:opacity-50"
            }
          >
            {stored ? "Edit outline" : "Trace the house"}
          </button>
          {stored && (
            <button
              type="button"
              disabled={removing}
              onClick={remove}
              className="text-sm font-semibold text-muted transition hover:text-clay disabled:opacity-50"
            >
              {removing ? "Removing…" : "Remove"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SavedOutline({
  stored,
  fetchedAt,
}: {
  stored: StoredBlueprint;
  fetchedAt: string | null;
}) {
  const traced = useMemo(() => tracedOutlineFrom(stored), [stored]);
  const shapes = useMemo<Shapes>(
    () => ({
      house: { points: traced.house, closed: true },
      boundary: { points: traced.boundary, closed: true },
    }),
    [traced]
  );
  const view = useMemo<MapView>(
    () => ({ kind: "fit", points: [...traced.house, ...traced.boundary] }),
    [traced]
  );
  const fromCounty = stored.provider !== TRACE_PROVIDER;

  return (
    <div>
      <div className="isolate overflow-hidden rounded-[10px] border border-rule">
        <TraceMap shapes={shapes} editing={null} view={view} className="h-[400px] w-full" />
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <Fact label="House">{describeShape(traced.house, { area: true })}</Fact>
        <Fact label="Boundary">{describeShape(traced.boundary)}</Fact>
        {fetchedAt && (
          <Fact label={fromCounty ? "Looked up" : "Traced"}>
            {new Date(fetchedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </Fact>
        )}
      </dl>

      {fromCounty && (
        <p className="mt-3 text-sm text-muted">
          Found by the old county lookup. Open it with Edit outline to check the
          corners against the aerial.
        </p>
      )}
      <p className="mt-3 text-[11px] text-faint">
        The aerial shows the roof, so the corners are the roof&apos;s — a foot
        or two outside the walls. On site, stand the corner post under the
        roof&apos;s corner, not the wall&apos;s.
      </p>
    </div>
  );
}

type SearchState =
  | { state: "idle" }
  | { state: "searching" }
  | { state: "found"; label: string; loose: boolean }
  | { state: "missed"; query: string }
  | { state: "failed"; message: string };

/** What a finished search does to the map and the status line. */
function afterSearch(query: string, hit: GeocodeHit | null): {
  search: SearchState;
  view: MapView | null;
} {
  if (!hit) return { search: { state: "missed", query }, view: null };
  return {
    // A street-level (not rooftop) match is the usual loose one: the map
    // lands on the right road, and the house is the designer's to find.
    search: { state: "found", label: hit.label, loose: hit.score < 95 },
    view: { kind: "center", lat: hit.lat, lng: hit.lng, zoom: 19 },
  };
}

function TraceEditor({
  address,
  initial,
  onCancel,
  onSave,
}: {
  address: string;
  initial: TracedOutline | null;
  onCancel: () => void;
  onSave: (outline: TracedOutline) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [shapes, setShapes] = useState<Shapes>(() => ({
    house: { points: initial?.house ?? [], closed: (initial?.house.length ?? 0) >= 3 },
    boundary: { points: initial?.boundary ?? [], closed: (initial?.boundary.length ?? 0) >= 3 },
  }));
  // Editing an outline opens on it; a first trace opens on the address.
  const [startsEmpty] = useState(
    () => (initial?.house.length ?? 0) + (initial?.boundary.length ?? 0) === 0
  );
  const [view, setView] = useState<MapView | null>(() =>
    startsEmpty
      ? null
      : { kind: "fit", points: [...initial!.house, ...initial!.boundary] }
  );
  const [search, setSearch] = useState<SearchState>(() =>
    startsEmpty ? { state: "searching" } : { state: "idle" }
  );
  const [query, setQuery] = useState(address);
  const [tool, setTool] = useState<ShapeKind>("house");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!startsEmpty) return;
    const controller = new AbortController();
    geocodeAddress(address, controller.signal)
      .then((hit) => {
        const next = afterSearch(address, hit);
        setSearch(next.search);
        if (next.view) setView(next.view);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setSearch({ state: "failed", message: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, [startsEmpty, address]);

  async function find(text: string) {
    const q = text.trim();
    if (!q) return;
    setSearch({ state: "searching" });
    try {
      const next = afterSearch(q, await geocodeAddress(q));
      setSearch(next.search);
      if (next.view) setView(next.view);
    } catch (err) {
      setSearch({ state: "failed", message: err instanceof Error ? err.message : String(err) });
    }
  }

  function update(kind: ShapeKind, shape: Shape) {
    setShapes((s) => ({ ...s, [kind]: shape }));
    setError(null);
  }

  function addCorner(kind: ShapeKind, point: LatLng) {
    setShapes((s) =>
      s[kind].closed ? s : { ...s, [kind]: { points: [...s[kind].points, point], closed: false } }
    );
    setError(null);
  }

  const active = shapes[tool];
  const houseDone = shapes.house.closed && shapes.house.points.length >= 3;
  const boundaryOpen = !shapes.boundary.closed && shapes.boundary.points.length > 0;
  const blocker = !houseDone
    ? "Close the house outline to save it."
    : boundaryOpen
      ? "Close the yard boundary, or clear it, to save."
      : null;

  async function save() {
    setSaving(true);
    setError(null);
    const result = await onSave({
      house: shapes.house.points,
      boundary: shapes.boundary.closed ? shapes.boundary.points : [],
    });
    // On success the card closes the editor; only a failure lands here.
    if (!result.ok) setError(result.error);
    setSaving(false);
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void find(query);
        }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Find an address on the map"
          className="min-w-0 flex-1 rounded-lg border border-rule-strong bg-card-hover px-3 py-2 text-sm text-ink outline-none transition focus:border-accent"
        />
        <button
          type="submit"
          disabled={search.state === "searching"}
          className="rounded-lg border border-rule-strong px-4 py-2 text-sm font-semibold text-body transition hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {search.state === "searching" ? "Finding…" : "Find"}
        </button>
      </form>
      <SearchStatus search={search} />

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="tablist" className="inline-flex rounded-lg border border-rule p-0.5">
          {(["house", "boundary"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={tool === kind}
              onClick={() => setTool(kind)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                tool === kind ? "bg-accent text-paper" : "text-muted hover:text-ink"
              }`}
            >
              {kind === "house" ? "House" : "Yard boundary"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!active.closed && active.points.length > 0 && (
            <ToolButton onClick={() => update(tool, { points: active.points.slice(0, -1), closed: false })}>
              Undo corner
            </ToolButton>
          )}
          {!active.closed && active.points.length >= 3 && (
            <ToolButton onClick={() => update(tool, { points: active.points, closed: true })}>
              Close outline
            </ToolButton>
          )}
          {active.points.length > 0 && (
            <ToolButton onClick={() => update(tool, { points: [], closed: false })}>
              Start over
            </ToolButton>
          )}
        </div>
      </div>
      <p className="mt-2 text-sm text-muted">{hint(tool, active)}</p>

      <div className="isolate mt-3 overflow-hidden rounded-[10px] border border-rule">
        <TraceMap
          shapes={shapes}
          editing={tool}
          onChange={update}
          onAddCorner={addCorner}
          view={view}
          className="h-[520px] w-full"
        />
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <Fact label="House">{describeDraft(shapes.house, { area: true })}</Fact>
        <Fact label="Boundary">{describeDraft(shapes.boundary)}</Fact>
      </dl>

      {error && <p className="mt-4 text-sm text-clay">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={blocker != null || saving}
          onClick={save}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-paper transition hover:bg-accent-bright disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save outline"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="text-sm font-semibold text-muted transition hover:text-ink disabled:opacity-50"
        >
          Cancel
        </button>
        {blocker && <span className="text-sm text-faint">{blocker}</span>}
      </div>
    </div>
  );
}

function SearchStatus({ search }: { search: SearchState }) {
  switch (search.state) {
    case "found":
      return search.loose ? (
        <p className="mt-1.5 text-sm text-gold">
          Closest match: {search.label}. Check the map is on the right house.
        </p>
      ) : null;
    case "missed":
      return (
        <p className="mt-1.5 text-sm text-gold">
          Couldn&apos;t find “{search.query}” on the map. Try another spelling,
          or pan and zoom to the house.
        </p>
      );
    case "failed":
      return (
        <p className="mt-1.5 text-sm text-clay">
          Address search isn&apos;t answering ({search.message}). Pan and zoom
          to the house instead.
        </p>
      );
    default:
      return null;
  }
}

function hint(tool: ShapeKind, shape: Shape): string {
  const n = shape.points.length;
  if (shape.closed) {
    return "Drag a corner to move it, or drag a midpoint to add one. Right-click a corner to remove it.";
  }
  if (n === 0) {
    return tool === "house"
      ? "Click each corner of the roof, in order around the house. Zoom in close — every corner is one the headset can walk to."
      : "Optional. Click each corner of the yard — the property wall or fence line.";
  }
  if (n < 3) return "Keep clicking corners.";
  return "Click the first corner (the white one) to close the outline.";
}

const corners = (n: number) => `${n} ${n === 1 ? "corner" : "corners"}`;

function describeShape(points: LatLng[], { area = false } = {}): string {
  if (points.length < 3) return "Not traced";
  return area
    ? `${corners(points.length)} · ${formatArea(ringAreaSqFt(points))} under roof`
    : corners(points.length);
}

function describeDraft(shape: Shape, { area = false } = {}): string {
  if (shape.points.length === 0) return "Not traced yet";
  if (!shape.closed) return `${corners(shape.points.length)}, still open`;
  return describeShape(shape.points, { area });
}

function ToolButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm font-semibold text-muted transition hover:text-ink"
    >
      {children}
    </button>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-faint">{label}</dt>
      <dd className="min-w-0 text-body">{children}</dd>
    </div>
  );
}

function formatArea(sqFt: number): string {
  if (sqFt >= 43560 * 0.5) return `${(sqFt / 43560).toFixed(2)} ac`;
  return `${Math.round(sqFt).toLocaleString("en-US")} sq ft`;
}
