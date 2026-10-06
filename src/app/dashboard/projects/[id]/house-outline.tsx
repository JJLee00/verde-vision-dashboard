"use client";

import { useEffect, useId, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StoredBlueprint } from "@/lib/blueprint/stored";
import type { LatLng } from "@/lib/blueprint/types";
import { sameHouse, streetLine } from "@/lib/blueprint/address";
import {
  geocodeAddress,
  reverseGeocode,
  suggestAddresses,
  type AddressSuggestion,
  type Basemap,
  type GeocodeHit,
  type PlaceAddress,
} from "@/lib/blueprint/esri";
import { ringCentroid, ringToXZMeters } from "@/lib/blueprint/normalize";
import {
  formatFeetInches,
  ringAreaSqFt,
  TRACE_PROVIDER,
  tracedOutlineFrom,
  type MapOffset,
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
        initialMapOffset={stored?.mapOffset ?? null}
        onCancel={() => setStart(null)}
        onSave={async (traced, address, mapOffset) => {
          const result = await saveTracedOutline(projectId, traced, address, mapOffset);
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
  const check = useHouseAddress(traced.house, stored.lookupAddress);
  const [expanded, setExpanded] = useExpanded();
  const facts = (
    <OutlineFacts
      house={{ points: traced.house, closed: true }}
      boundary={{ points: traced.boundary, closed: true }}
      address={stored.lookupAddress}
      compact={expanded}
    />
  );

  // One tree for both sizes, so the map is never remounted (and never loses
  // its place) when it expands: only the classes and the extras change.
  return (
    <div className={expanded ? FULL_PAGE : ""}>
      <div className={expanded ? FULL_PAGE_MAP : "isolate overflow-hidden rounded-[10px] border border-rule"}>
        <TraceMap
          shapes={shapes}
          editing={null}
          view={view}
          mapOffset={stored.mapOffset ?? null}
          houseLabel={houseLabelFor(check, stored.lookupAddress)}
          expanded={expanded}
          onToggleExpand={() => setExpanded((e) => !e)}
          status={
            expanded ? (
              <StatusCard>
                {facts}
                <HouseCheckLine check={check} typed={stored.lookupAddress} compact />
              </StatusCard>
            ) : null
          }
          className={expanded ? "h-full w-full" : "h-[400px] w-full"}
        />
      </div>

      {!expanded && (
        <>
          <div className="mt-3">
            {facts}
            {fetchedAt && (
              <dl className="mt-1.5 text-sm">
                <Fact label={fromCounty ? "Looked up" : "Traced"}>
                  {new Date(fetchedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </Fact>
              </dl>
            )}
          </div>
          <HouseCheckLine check={check} typed={stored.lookupAddress} />

          {fromCounty && (
            <p className="mt-3 text-sm text-muted">
              Found by the old county lookup. Open it with Edit outline to check
              the corners against the map.
            </p>
          )}
          <p className="mt-3 text-[11px] text-faint">
            The outline follows the roof, so its corners sit a foot or two
            outside the walls. On site, stand the corner post under the
            roof&apos;s corner, not the wall&apos;s.
          </p>
        </>
      )}
    </div>
  );
}

// ── Is this the right house? ──────────────────────────────────────────

type HouseCheck =
  | { state: "none" }
  | { state: "checking" }
  | { state: "unknown" }
  | { state: "found"; found: PlaceAddress; match: boolean | null };

/**
 * Looks up the street address at the centre of a finished house outline,
 * and compares it with the address the designer searched for. Catches the
 * one mistake that matters here: a careful trace of the neighbour's roof.
 * Re-runs (a beat after the last change) whenever the outline moves.
 */
function useHouseAddress(house: LatLng[], typed: string): HouseCheck {
  const centre = house.length >= 3 ? ringCentroid(house) : null;
  // Rounded to ~10 cm: a string key keeps the effect from re-firing on
  // every render's fresh array.
  const key = centre ? `${centre.lat.toFixed(6)},${centre.lng.toFixed(6)}` : null;
  const [result, setResult] = useState<{ key: string; found: PlaceAddress | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    const [lat, lng] = key.split(",").map(Number);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      reverseGeocode({ lat, lng }, controller.signal)
        .then((found) => setResult({ key, found }))
        .catch(() => {
          if (!controller.signal.aborted) setResult({ key, found: null });
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  if (!key) return { state: "none" };
  if (!result || result.key !== key) return { state: "checking" };
  if (!result.found) return { state: "unknown" };
  return { state: "found", found: result.found, match: sameHouse(typed, result.found) };
}

/**
 * The label on the house: the address actually found there once known —
 * so a neighbour's roof shows the neighbour's number — and the searched
 * address until then.
 */
function houseLabelFor(check: HouseCheck, typed: string): string | null {
  if (check.state === "found") return check.found.street;
  return typed ? streetLine(typed) : null;
}

function HouseCheckLine({
  check,
  typed,
  compact = false,
}: {
  check: HouseCheck;
  typed: string;
  /** Status-card size, for the full-screen map. */
  compact?: boolean;
}) {
  const size = compact ? "mt-1 text-xs" : "mt-2 text-sm";
  switch (check.state) {
    case "checking":
      return <p className={`${size} text-faint`}>Checking the address at this outline…</p>;
    case "unknown":
      return (
        <p className={`${size} text-faint`}>
          No street address found at this outline — check the map is on the
          right house.
        </p>
      );
    case "found":
      if (check.match === true) {
        return <p className={`${size} text-accent`}>✓ This is {check.found.street}.</p>;
      }
      if (check.match === false) {
        return (
          <p className={`${size} text-gold`}>
            ⚠ This outline is on {check.found.street}, not {streetLine(typed)}.
            Check you traced the right house.
          </p>
        );
      }
      return <p className={`${size} text-muted`}>This outline is on {check.found.street}.</p>;
    default:
      return null;
  }
}

// ── Expand ────────────────────────────────────────────────────────────

/**
 * Expanded is the whole window, sidebar and all: a slim top bar, and the map
 * filling everything under it with the tools and facts floated on top.
 */
const FULL_PAGE = "fixed inset-0 z-[60] flex flex-col bg-paper";
const FULL_PAGE_MAP = "relative isolate min-h-0 flex-1";

/**
 * Expanded state for a map section: Esc closes it (unless something inside,
 * like the address suggestions, used the Esc first) and the page behind
 * stops scrolling, so the wheel only ever zooms the map.
 */
function useExpanded() {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [expanded]);
  return [expanded, setExpanded] as const;
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
                // Claimed, so an expanded map doesn't also close on it.
                e.preventDefault();
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

/**
 * Everything one Undo steps back over: both shapes, the Map offset (a slide
 * onto the roof moves it), and which base map the house was finished on
 * (the thing that decides whether such a slide calibrates the Map).
 */
type Doc = { shapes: Shapes; mapOffset: MapOffset | null; houseClosedOn: Basemap | null };
type History = { doc: Doc; past: Doc[] };
type HistoryAction =
  // A change the designer made: Undo can take it back.
  | { type: "apply"; change: (d: Doc) => Doc }
  // Rides on the step just made — the Map offset a slide implies — so one
  // Undo puts the outline and the Map back together.
  | { type: "amend"; change: (d: Doc) => Doc }
  | { type: "undo" };

const MAX_UNDO = 100;

function history(h: History, action: HistoryAction): History {
  if (action.type === "undo") {
    if (h.past.length === 0) return h;
    return { doc: h.past[h.past.length - 1], past: h.past.slice(0, -1) };
  }
  const doc = action.change(h.doc);
  if (doc === h.doc) return h;
  if (action.type === "amend") return { ...h, doc };
  return { doc, past: [...h.past, h.doc].slice(-MAX_UNDO) };
}

function TraceEditor({
  start,
  initial,
  initialMapOffset,
  onCancel,
  onSave,
}: {
  start: EditorStart;
  initial: TracedOutline | null;
  initialMapOffset: MapOffset | null;
  onCancel: () => void;
  onSave: (
    outline: TracedOutline,
    address: string,
    mapOffset: MapOffset | null
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [{ doc, past }, dispatch] = useReducer(history, null, () => ({
    doc: {
      shapes: {
        house: { points: initial?.house ?? [], closed: (initial?.house.length ?? 0) >= 3 },
        boundary: { points: initial?.boundary ?? [], closed: (initial?.boundary.length ?? 0) >= 3 },
      },
      mapOffset: initialMapOffset,
      houseClosedOn: null,
    },
    past: [],
  }));
  const { shapes, mapOffset } = doc;
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
  // Read only in handlers: which base map is in view.
  const basemapRef = useRef<Basemap>("satellite");
  const check = useHouseAddress(shapes.house.closed ? shapes.house.points : [], address);
  const [expanded, setExpanded] = useExpanded();

  function update(kind: ShapeKind, shape: Shape) {
    const basemap = basemapRef.current;
    dispatch({
      type: "apply",
      change: (d) => {
        let closedOn = d.houseClosedOn;
        if (kind === "house") {
          if (!d.shapes.house.closed && shape.closed) closedOn = basemap;
          if (shape.points.length === 0) closedOn = null;
        }
        return { ...d, houseClosedOn: closedOn, shapes: { ...d.shapes, [kind]: shape } };
      },
    });
    setError(null);
  }

  function addCorner(kind: ShapeKind, point: LatLng) {
    dispatch({
      type: "apply",
      change: (d) =>
        d.shapes[kind].closed
          ? d
          : {
              ...d,
              shapes: {
                ...d.shapes,
                [kind]: { points: [...d.shapes[kind].points, point], closed: false },
              },
            },
    });
    setError(null);
  }

  /**
   * A house finished on the Map and then slid onto the satellite roof: the
   * slide is exactly how far the Map's footprints are off at this property,
   * so the Map view takes the same shift and the two views agree from here
   * on. Every such slide adds to it, so aligning in two nudges still works.
   * A house traced on Satellite is already true; dragging it is just an
   * adjustment and leaves the Map alone. So is anything dragged on the Map.
   */
  function moveWhole(kind: ShapeKind, from: LatLng, to: LatLng) {
    if (kind !== "house" || basemapRef.current !== "satellite") return;
    const [[east, south]] = ringToXZMeters([to], from);
    dispatch({
      type: "amend",
      change: (d) =>
        d.houseClosedOn !== "map"
          ? d
          : {
              ...d,
              mapOffset: {
                east: (d.mapOffset?.east ?? 0) + east,
                north: (d.mapOffset?.north ?? 0) - south,
              },
            },
    });
  }

  function undo() {
    dispatch({ type: "undo" });
    setError(null);
  }

  // ⌘Z / Ctrl+Z steps back — except while typing an address, where the
  // box's own undo is the one meant.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
      dispatch({ type: "undo" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      address,
      mapOffset
    );
    // On success the card closes the editor; only a failure lands here.
    if (!result.ok) setError(result.error);
    setSaving(false);
  }

  const facts = (
    <OutlineFacts
      house={shapes.house}
      boundary={shapes.boundary}
      mapOffset={mapOffset}
      onResetMapOffset={() =>
        dispatch({ type: "apply", change: (d) => (d.mapOffset ? { ...d, mapOffset: null } : d) })
      }
      compact={expanded}
    />
  );

  // The drawing tools live on the map itself, bottom-left.
  const toolbar = (
    <div className="flex flex-wrap gap-2">
      <MapButton onClick={undo} disabled={past.length === 0} title="Undo (⌘Z or Ctrl+Z)">
        <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5.5 3.5 2.5 6.5l3 3" />
          <path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" />
        </svg>
        Undo
      </MapButton>
      {!active.closed && active.points.length >= 3 && (
        <MapButton onClick={() => update(tool, { points: active.points, closed: true })}>
          Close outline
        </MapButton>
      )}
      {active.points.length > 0 && (
        <MapButton onClick={() => update(tool, { points: [], closed: false })}>Start over</MapButton>
      )}
    </div>
  );

  const saveControls = (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={blocker != null || saving}
        onClick={save}
        title={blocker ?? undefined}
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
      {error && <span className="text-sm text-clay">{error}</span>}
    </div>
  );

  // One tree for both sizes, so the map is never remounted (and never loses
  // its place) when it expands: only the classes and the extras change.
  // Nothing above the map changes height while drawing — the tools and the
  // hint float on the map — so it never jumps under the cursor.
  return (
    <div className={expanded ? FULL_PAGE : ""}>
      <div
        className={
          expanded
            ? "flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule bg-card px-4 py-3"
            : ""
        }
      >
        <div className={expanded ? "min-w-[16rem] max-w-xl flex-1" : ""}>
          <AddressSearch
            initialQuery={start.query}
            initialStatus={start.status}
            onFound={(hit, query) => {
              setView({ kind: "center", lat: hit.lat, lng: hit.lng, zoom: 19 });
              setAddress(addressFor(hit, query));
            }}
          />
        </div>
        <div className={expanded ? "" : "mt-3"}>
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
        {expanded && <div className="ml-auto">{saveControls}</div>}
      </div>

      <div
        className={expanded ? FULL_PAGE_MAP : "isolate mt-3 overflow-hidden rounded-[10px] border border-rule"}
      >
        <TraceMap
          shapes={shapes}
          editing={tool}
          onChange={update}
          onAddCorner={addCorner}
          onMoveWhole={moveWhole}
          onBasemapChange={(b) => {
            basemapRef.current = b;
          }}
          mapOffset={mapOffset}
          houseLabel={shapes.house.closed ? houseLabelFor(check, address) : null}
          expanded={expanded}
          onToggleExpand={() => setExpanded((e) => !e)}
          hint={hint(tool, active)}
          toolbar={toolbar}
          status={
            expanded ? (
              <StatusCard>
                {facts}
                <HouseCheckLine check={check} typed={address} compact />
              </StatusCard>
            ) : null
          }
          view={view}
          className={expanded ? "h-full w-full" : "h-[520px] w-full"}
        />
      </div>

      {!expanded && (
        <>
          <div className="mt-3">{facts}</div>
          <HouseCheckLine check={check} typed={address} />
          <div className="mt-4">{saveControls}</div>
        </>
      )}
    </div>
  );
}

/** Short, because it floats on the map. */
function hint(tool: ShapeKind, shape: Shape): string {
  const n = shape.points.length;
  if (shape.closed) {
    return "Drag a corner or the whole outline. Right-click a corner to remove it.";
  }
  if (n === 0) {
    return tool === "house"
      ? "Click each corner of the roof, in order around the house."
      : "Optional: click each corner of the yard. Lot lines shows the county's lot to follow.";
  }
  if (n < 3) return "Keep clicking corners.";
  return "Click the white first corner to close the outline.";
}

/** The facts under the map, or in its status card when full screen. */
function OutlineFacts({
  house,
  boundary,
  address,
  mapOffset,
  onResetMapOffset,
  compact = false,
}: {
  house: Shape;
  boundary: Shape;
  address?: string;
  mapOffset?: MapOffset | null;
  onResetMapOffset?: () => void;
  compact?: boolean;
}) {
  const shifted = mapOffset ? Math.hypot(mapOffset.east, mapOffset.north) : 0;
  return (
    <dl
      className={
        compact
          ? "flex flex-col gap-0.5 text-xs"
          : "grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2"
      }
    >
      {address && (
        <div className={compact ? "" : "sm:col-span-2"}>
          <Fact label="Address" compact={compact}>
            {address}
          </Fact>
        </div>
      )}
      <Fact label="House" compact={compact}>
        {describeDraft(house, "roof")}
      </Fact>
      <Fact label="Boundary" compact={compact}>
        {describeDraft(boundary, "lot")}
      </Fact>
      {shifted > 0.3 && (
        <div className={compact ? "" : "sm:col-span-2"}>
          <Fact label="Map view" compact={compact}>
            Lined up with the satellite here (moved {formatFeetInches(shifted)})
            {onResetMapOffset && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={onResetMapOffset}
                  className="font-semibold text-muted underline-offset-2 transition hover:text-ink hover:underline"
                >
                  Reset
                </button>
              </>
            )}
          </Fact>
        </div>
      )}
    </dl>
  );
}

function StatusCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[30rem] rounded-lg bg-card/95 px-3 py-2 shadow-sm ring-1 ring-rule-strong">
      {children}
    </div>
  );
}

/** A control that sits on the map, styled like its other switches. */
function MapButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center gap-1.5 rounded-lg bg-card px-2.5 py-1.5 text-xs font-semibold text-body shadow-sm ring-1 ring-rule-strong transition hover:text-ink disabled:cursor-default disabled:opacity-45"
    >
      {children}
    </button>
  );
}

const corners = (n: number) => `${n} ${n === 1 ? "corner" : "corners"}`;

/** "roof" for a house (area under it), "lot" for a boundary (lot size). */
type AreaKind = "roof" | "lot";

function describeShape(points: LatLng[], area: AreaKind): string {
  if (points.length < 3) return "Not traced";
  const sqFt = ringAreaSqFt(points);
  return area === "roof"
    ? `${corners(points.length)} · ${formatArea(sqFt)} under roof`
    : `${corners(points.length)} · ${formatLot(sqFt)}`;
}

function describeDraft(shape: Shape, area: AreaKind): string {
  if (shape.points.length === 0) return "Not traced yet";
  if (!shape.closed) return `${corners(shape.points.length)}, still open`;
  return describeShape(shape.points, area);
}

function Fact({
  label,
  compact = false,
  children,
}: {
  label: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <dt className={`${compact ? "w-16" : "w-20"} shrink-0 text-faint`}>{label}</dt>
      <dd className="min-w-0 text-body">{children}</dd>
    </div>
  );
}

/** Lot size the way it's quoted: acres for anything sizeable, with sq ft. */
function formatLot(sqFt: number): string {
  const ft = `${Math.round(sqFt).toLocaleString("en-US")} sq ft`;
  return sqFt >= 43560 * 0.25 ? `${(sqFt / 43560).toFixed(2)} ac (${ft})` : ft;
}

function formatArea(sqFt: number): string {
  if (sqFt >= 43560 * 0.5) return `${(sqFt / 43560).toFixed(2)} ac`;
  return `${Math.round(sqFt).toLocaleString("en-US")} sq ft`;
}
