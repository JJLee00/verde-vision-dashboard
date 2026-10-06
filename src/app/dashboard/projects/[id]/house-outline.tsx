"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StoredBlueprint } from "@/lib/blueprint/stored";
import type { LatLng } from "@/lib/blueprint/types";
import {
  geocodeAddress,
  suggestAddresses,
  type AddressSuggestion,
  type GeocodeHit,
} from "@/lib/blueprint/esri";
import {
  ringAreaSqFt,
  TRACE_PROVIDER,
  tracedOutlineFrom,
  type TracedOutline,
} from "@/lib/blueprint/trace";
import { removeHouseOutline, saveTracedOutline } from "./house-outline-actions";
import { TraceMap, type MapView, type Shape, type ShapeKind, type Shapes } from "./trace-map";

/**
 * The house outline the headset will walk, traced by the designer on a map
 * at a desk.
 *
 * This used to be a county lookup plus an automatic trace of the roof from
 * Solar imagery, which only ever covered Maricopa County. Tracing by hand
 * works at any address, and the headset receives the same outline either
 * way: on site, Blueprint opens on the corner walk — walk to two of these
 * corners and the outline drops into the yard.
 *
 * The card finds the property with its own search box rather than the
 * project's address field: the address on file is for the customer record
 * and is often partial, while this search is for putting a map on a roof.
 */
export function HouseOutline({
  projectId,
  outline,
  ready,
  disabled,
}: {
  projectId: string;
  outline: { stored: StoredBlueprint; fetchedAt: string | null } | null;
  /** False until migration-020 has been run. */
  ready: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  // Set while the editor is open: where it opens, and what found it.
  const [start, setStart] = useState<EditorStart | null>(null);
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

  if (start) {
    return (
      <TraceEditor
        start={start}
        initial={stored ? tracedOutlineFrom(stored) : null}
        onCancel={() => setStart(null)}
        onSave={async (traced, address) => {
          const result = await saveTracedOutline(projectId, traced, address);
          if (result.ok) {
            setStart(null);
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

  if (!stored) {
    if (disabled) return <p className="text-sm text-muted">No house outline yet.</p>;
    return (
      <div>
        <p className="text-sm text-muted">
          Search for the property, then click around the roof, corner by
          corner. The headset picks the outline up on its next sync — on site,
          walk to two of its corners and it drops into the yard.
        </p>
        <div className="mt-3">
          <AddressSearch
            initialQuery=""
            onFound={(hit, query, status) => setStart(startAt(hit, query, status))}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <SavedOutline stored={stored} fetchedAt={outline?.fetchedAt ?? null} />
      {error && <p className="mt-4 text-sm text-clay">{error}</p>}
      {!disabled && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={removing}
            onClick={() => {
              setError(null);
              setStart({
                query: stored.lookupAddress,
                address: stored.lookupAddress,
                view: null, // opens framed on the outline
                status: { state: "idle" },
              });
            }}
            className="rounded-lg border border-rule-strong px-4 py-2 text-sm font-semibold text-body transition hover:border-accent hover:text-accent disabled:opacity-50"
          >
            Edit outline
          </button>
          <button
            type="button"
            disabled={removing}
            onClick={remove}
            className="text-sm font-semibold text-muted transition hover:text-clay disabled:opacity-50"
          >
            {removing ? "Removing…" : "Remove"}
          </button>
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
        {stored.lookupAddress && (
          <div className="sm:col-span-2">
            <Fact label="Address">{stored.lookupAddress}</Fact>
          </div>
        )}
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
          corners against the map.
        </p>
      )}
      <p className="mt-3 text-[11px] text-faint">
        The outline follows the roof, so its corners sit a foot or two outside
        the walls. On site, stand the corner post under the roof&apos;s corner,
        not the wall&apos;s.
      </p>
    </div>
  );
}

// ── Finding the property ──────────────────────────────────────────────

type SearchState =
  | { state: "idle" }
  | { state: "searching" }
  | { state: "found"; label: string; loose: boolean }
  | { state: "missed"; query: string }
  | { state: "failed"; message: string };

/**
 * A street-level (not rooftop) match is the usual loose one: the map lands
 * on the right road, and the house is the designer's to find.
 */
const LOOSE_BELOW = 95;

/**
 * What the outline records as its address: Esri's tidy version of an exact
 * match, or the designer's own words when the match was loose — those name
 * the house more precisely than the street Esri found.
 */
function addressFor(hit: GeocodeHit, query: string): string {
  return hit.score >= LOOSE_BELOW ? hit.label : query.trim();
}

type EditorStart = {
  query: string;
  address: string;
  view: MapView | null;
  status: SearchState;
};

function startAt(hit: GeocodeHit, query: string, status: SearchState): EditorStart {
  return {
    query,
    address: addressFor(hit, query),
    view: { kind: "center", lat: hit.lat, lng: hit.lng, zoom: 19 },
    status,
  };
}

/**
 * An address box with Esri's suggestions under it. Picking a suggestion or
 * pressing Find looks the address up; `onFound` gets the hit.
 */
function AddressSearch({
  initialQuery,
  initialStatus = { state: "idle" },
  onFound,
}: {
  initialQuery: string;
  initialStatus?: SearchState;
  onFound: (hit: GeocodeHit, query: string, status: SearchState) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState<SearchState>(initialStatus);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const listId = useId();

  // Suggestions follow the typing, a beat behind it.
  useEffect(() => {
    const text = query.trim();
    if (!open || text.length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      suggestAddresses(text, controller.signal)
        .then((list) => {
          setSuggestions(list);
          setHighlight(-1);
        })
        // A failed suggestion is just no dropdown; Find still works.
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  const showList = open && query.trim().length >= 3 && suggestions.length > 0;

  async function find(text: string, magicKey?: string) {
    const q = text.trim();
    if (!q) return;
    setOpen(false);
    setStatus({ state: "searching" });
    try {
      const hit = await geocodeAddress(q, { magicKey });
      if (!hit) {
        setStatus({ state: "missed", query: q });
        return;
      }
      const found: SearchState = { state: "found", label: hit.label, loose: hit.score < LOOSE_BELOW };
      setStatus(found);
      onFound(hit, q, found);
    } catch (err) {
      setStatus({ state: "failed", message: err instanceof Error ? err.message : String(err) });
    }
  }

  function choose(s: AddressSuggestion) {
    setQuery(s.text);
    void find(s.text, s.magicKey);
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (showList && highlight >= 0) choose(suggestions[highlight]);
          else void find(query);
        }}
        className="flex gap-2"
      >
        <div className="relative min-w-0 flex-1">
          <input
            value={query}
            placeholder="Search for the property's address"
            role="combobox"
            aria-label="Property address"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && highlight >= 0 ? `${listId}-${highlight}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (!showList) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => (h + 1) % suggestions.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            className="w-full rounded-lg border border-rule-strong bg-card-hover px-3 py-2 text-sm text-ink outline-none transition placeholder:text-faint focus:border-accent"
          />
          {showList && (
            // Above the map: the editor's map sits right under this box.
            <ul
              id={listId}
              role="listbox"
              className="absolute left-0 right-0 top-full z-[1100] mt-1 overflow-hidden rounded-lg border border-rule-strong bg-card shadow-lg"
            >
              {suggestions.map((s, i) => (
                <li
                  key={s.magicKey}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === highlight}
                  // mousedown, not click: the input's blur would close the
                  // list before a click could land.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(s);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`cursor-pointer px-3 py-2 text-sm ${
                    i === highlight ? "bg-card-hover text-ink" : "text-body"
                  }`}
                >
                  {s.text}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="submit"
          disabled={status.state === "searching"}
          className="rounded-lg border border-rule-strong px-4 py-2 text-sm font-semibold text-body transition hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {status.state === "searching" ? "Finding…" : "Find"}
        </button>
      </form>
      <SearchStatus search={status} />
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
          Couldn&apos;t find “{search.query}”. Try another spelling, or pick
          one of the suggestions as you type.
        </p>
      );
    case "failed":
      return (
        <p className="mt-1.5 text-sm text-clay">
          Address search isn&apos;t answering ({search.message}). Try again in a
          moment.
        </p>
      );
    default:
      return null;
  }
}

// ── Tracing ───────────────────────────────────────────────────────────

function TraceEditor({
  start,
  initial,
  onCancel,
  onSave,
}: {
  start: EditorStart;
  initial: TracedOutline | null;
  onCancel: () => void;
  onSave: (
    outline: TracedOutline,
    address: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [shapes, setShapes] = useState<Shapes>(() => ({
    house: { points: initial?.house ?? [], closed: (initial?.house.length ?? 0) >= 3 },
    boundary: { points: initial?.boundary ?? [], closed: (initial?.boundary.length ?? 0) >= 3 },
  }));
  // A search opens on what it found; Edit outline opens framed on the outline.
  const [view, setView] = useState<MapView | null>(() => {
    if (start.view) return start.view;
    const points = [...(initial?.house ?? []), ...(initial?.boundary ?? [])];
    return points.length > 0 ? { kind: "fit", points } : null;
  });
  const [address, setAddress] = useState(start.address);
  const [tool, setTool] = useState<ShapeKind>("house");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const result = await onSave(
      {
        house: shapes.house.points,
        boundary: shapes.boundary.closed ? shapes.boundary.points : [],
      },
      address
    );
    // On success the card closes the editor; only a failure lands here.
    if (!result.ok) setError(result.error);
    setSaving(false);
  }

  return (
    <div>
      <AddressSearch
        initialQuery={start.query}
        initialStatus={start.status}
        onFound={(hit, query) => {
          setView({ kind: "center", lat: hit.lat, lng: hit.lng, zoom: 19 });
          setAddress(addressFor(hit, query));
        }}
      />

      {/* Nothing above the map may change height while drawing: the first
          corner used to bring in a row of buttons and a shorter hint, and
          the map jumped under the cursor between clicks. The hint and the
          corner tools live below it for that reason. */}
      <div className="mt-3">
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
      </div>

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

      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
        <p className="text-sm text-muted">{hint(tool, active)}</p>
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
