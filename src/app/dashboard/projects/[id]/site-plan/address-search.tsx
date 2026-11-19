"use client";

import { useEffect, useId, useState } from "react";
import { sameHouse, streetLine } from "@/lib/blueprint/address";
import {
  geocodeAddress,
  reverseGeocode,
  suggestAddresses,
  type AddressSuggestion,
  type GeocodeHit,
  type PlaceAddress,
} from "@/lib/blueprint/esri";
import { ringCentroid } from "@/lib/blueprint/normalize";
import type { LatLng } from "@/lib/blueprint/types";

// Finding the property, and checking the traced house is the one searched
// for. Moved here from the old House outline card.
//
// The check runs on the house the headset walks, so a careful trace of the
// neighbour's roof is caught before anyone drives out.

// ── Is this the right house? ──────────────────────────────────────────

export type HouseCheck =
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
export function useHouseAddress(house: LatLng[], typed: string): HouseCheck {
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

export function HouseCheckLine({
  check,
  typed,
  compact = false,
}: {
  check: HouseCheck;
  typed: string;
  /** Smaller, for the builder's side panel. */
  compact?: boolean;
}) {
  const size = compact ? "mt-1 text-xs" : "mt-2 text-sm";
  switch (check.state) {
    case "checking":
      return <p className={`${size} text-faint`}>Checking the address at this house…</p>;
    case "unknown":
      return (
        <p className={`${size} text-faint`}>
          No street address found here — check the photo is on the
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
            ⚠ This is {check.found.street}, not {streetLine(typed)}.
            Check you traced the right house.
          </p>
        );
      }
      return <p className={`${size} text-muted`}>This is {check.found.street}.</p>;
    default:
      return null;
  }
}

// ── Finding the property ──────────────────────────────────────────────

export type SearchState =
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
 * What the plan records as its address: Esri's tidy version of an exact
 * match, or the designer's own words when the match was loose — those name
 * the house more precisely than the street Esri found.
 */
export function addressFor(hit: GeocodeHit, query: string): string {
  return hit.score >= LOOSE_BELOW ? hit.label : query.trim();
}

/**
 * An address box with Esri's suggestions under it. Picking a suggestion or
 * pressing Find looks the address up; `onFound` gets the hit.
 */
export function AddressSearch({
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
                // Claimed, so the sheet doesn't also take it.
                e.preventDefault();
                setOpen(false);
              }
            }}
            className="w-full rounded-lg border border-rule-strong bg-card-hover px-3 py-2 text-sm text-ink outline-none transition placeholder:text-faint focus:border-accent"
          />
          {showList && (
            // Above the sheet, which sits right under this box.
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

