"use client";

// The estimate builder — a full-screen, ruled grid (Oct 4 2026).
//
// Landscape designers finish bids in QuickBooks and spreadsheets, and a page
// that reads like a ledger reads as safe. So: square corners, a line around
// every cell, a shaded header row, money right-aligned in even-width digits
// with no $ on every cell, and cells you click straight into — Tab moves
// across, Enter moves down, Enter on the last row starts a new line. The
// editorial cards this replaced were right for the client's proposal and
// wrong for the place the money gets built.
//
// Same editing grammar as before: commit on blur, optimistic update, roll
// back and explain on error, green wash on success.
//
// Two row kinds, and the difference is the whole feature:
//   • source 'ar'     — written by the design. A headset resync rewrites
//                       these, so description/category/quantity are fixed
//                       here. Typing over the price sets price_overridden and
//                       typing over the labor sets labor_overridden; a resync
//                       then updates the QUANTITY and leaves those alone.
//   • source 'manual' — typed here. A resync never touches them.
//
// Every line carries its own Labor beside its Price (migration 023); Amount
// is quantity × (price + labor), and tax applies to the material part only.

import Link from "next/link";
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { plantForKey } from "@/lib/design-edit";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  ESTIMATE_ITEM_COLUMNS,
  computeTotals,
  lineTotal,
  midpointSortOrder,
  nextSortOrder,
  qtyLabel,
  round2,
  sortItems,
  fromRow,
  type EstimateCategory,
  type EstimateItem,
  type EstimateSettings,
} from "@/lib/estimate";

export type SavedItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  unit: string;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
// Ledger convention: two decimals, separators, and the $ only on the Total.
const amount = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// What a brand-new manual line is called before the designer names it.
// estimate_items forbids an empty description, so the row is born named and
// the name is selected for typing.
const NEW_LINE_DESCRIPTION = "New line";

// ── The grid's look, in one place ──────────────────────────────────────────
const GRID = "border border-ink/20";
const TH = `${GRID} bg-paper-deep px-2.5 py-2 text-left text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted`;
const TD = `${GRID} p-0 align-middle`;
const TEXT_CELL = "block px-2.5 py-2 text-sm";
// An input that IS the cell: no box, no radius, until it has focus.
const INPUT =
  "block h-9 w-full bg-transparent px-2.5 text-sm text-body outline-none placeholder:text-faint focus:bg-card-hover focus:outline-2 focus:-outline-offset-2 focus:outline-accent";
const BUTTON =
  "border border-ink/25 bg-card px-3 py-1.5 text-[13px] font-semibold text-ink transition hover:bg-card-hover disabled:opacity-50";
const BUTTON_PRIMARY =
  "border border-accent bg-accent px-3 py-1.5 text-[13px] font-semibold text-paper transition hover:bg-accent-bright disabled:opacity-50";

/** A design line still at $0 — its plant or surface has no price in the grid. */
const isUnpriced = (i: EstimateItem) => i.source === "ar" && i.unitPrice === 0;

export function EstimateBuilder({
  projectId,
  projectName,
  initialItems,
  initialSettings,
  initialTerms,
  savedItems,
  canEdit,
  isOwner,
  sample = false,
  children,
}: {
  projectId: string;
  projectName: string;
  initialItems: EstimateItem[];
  initialSettings: EstimateSettings;
  initialTerms: string;
  savedItems: SavedItem[];
  canEdit: boolean;
  isOwner: boolean;
  /** The dev fixture: shown, never written. */
  sample?: boolean;
  /** Notices (a migration not yet run) shown under the top bar. */
  children?: React.ReactNode;
}) {
  const [items, setItems] = useState(initialItems);
  const [settings, setSettings] = useState(initialSettings);
  const [error, setError] = useState<string | null>(null);
  const [wash, setWash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Offered AFTER a price edit on a design row, never during. A dialog on
  // every edit would turn typing a bid into a fight — you touch several
  // rows in a row — so this is a quiet bar that dismisses itself.
  const [priceOffer, setPriceOffer] = useState<{
    itemId: string;
    plantName: string;
    plantKey: string;
    size: string;
    price: number;
  } | null>(null);
  const [notesOpen, setNotesOpen] = useState<Set<string>>(new Set());
  // Named after adding a row so the new description input takes focus the
  // moment it mounts. Done in the ref callback, not an effect: the input
  // doesn't exist yet when the row is created.
  const pendingFocus = useRef<string | null>(null);

  const totals = computeTotals(items, settings);
  const unpriced = items.filter(isUnpriced).length;
  const ordered = sortItems(items);
  const readOnly = !canEdit;

  function flash(key: string) {
    setWash(key);
    setTimeout(() => setWash((w) => (w === key ? null : w)), 1000);
  }

  // Keep projects.estimate_amount derived rather than hand-set, so the
  // project card and the bid can never disagree. Fire-and-forget: a failure
  // here is a stale card, not lost work, and the next edit retries it.
  function syncProjectTotal(nextItems: EstimateItem[], next: EstimateSettings) {
    const total = computeTotals(nextItems, next).total;
    void createClient()
      .from("projects")
      .update({ estimate_amount: total })
      .eq("id", projectId);
  }

  async function patch(item: EstimateItem, changes: Partial<EstimateItem>) {
    const before = items;
    const merged: EstimateItem = { ...item, ...changes };
    const payload: Record<string, unknown> = {};
    if ("description" in changes) payload.description = merged.description;
    if ("category" in changes) payload.category = merged.category;
    if ("quantity" in changes) payload.quantity = merged.quantity;
    if ("unitPrice" in changes) {
      payload.unit_price = merged.unitPrice;
      // An AR row whose price a human typed must survive the next resync.
      if (merged.source === "ar" && !merged.priceOverridden) {
        payload.price_overridden = true;
        merged.priceOverridden = true;
      }
      // Only owners can write the price book, so only they are offered it.
      if (merged.source === "ar" && isOwner) {
        // A plant row's key is plant:<catalog key>:<size> — the grid cell.
        const [kind, plantKey, ...sizeParts] = (merged.arKey ?? "").split(":");
        const plant = kind === "plant" ? plantForKey(plantKey ?? "") : null;
        const size = sizeParts.join(":");
        if (plant && size && merged.unitPrice > 0) {
          setPriceOffer({
            itemId: merged.id,
            plantName: plant.name,
            plantKey: plant.key,
            size,
            price: merged.unitPrice,
          });
        }
      }
    }
    if ("laborUnitPrice" in changes) {
      payload.labor_unit_price = merged.laborUnitPrice;
      // Same contract as the price: typed labor survives a resync.
      if (merged.source === "ar" && !merged.laborOverridden) {
        payload.labor_overridden = true;
        merged.laborOverridden = true;
      }
    }
    if ("taxable" in changes) payload.taxable = merged.taxable;
    if ("note" in changes) payload.note = merged.note;
    if ("sortOrder" in changes) payload.sort_order = merged.sortOrder;

    merged.total = lineTotal(merged);
    const next = items.map((i) => (i.id === item.id ? merged : i));
    setItems(next);
    setError(null);

    const { error: err } = await createClient()
      .from("estimate_items")
      .update(payload)
      .eq("id", item.id);
    if (err) {
      setItems(before);
      setError("Could not save that change.");
      return;
    }
    flash(item.id);
    syncProjectTotal(next, settings);
  }

  async function addRow(seed?: Partial<EstimateItem>) {
    setBusy(true);
    setError(null);
    const { data, error: err } = await createClient()
      .from("estimate_items")
      .insert({
        project_id: projectId,
        sort_order: nextSortOrder(items),
        // Not "" — estimate_items requires length(trim(description)) > 0.
        description: seed?.description ?? NEW_LINE_DESCRIPTION,
        category: seed?.category ?? "other",
        quantity: seed?.quantity ?? 1,
        unit: seed?.unit ?? "each",
        unit_price: seed?.unitPrice ?? 0,
        labor_unit_price: seed?.laborUnitPrice ?? 0,
        taxable: seed?.taxable ?? true,
        source: "manual",
      })
      .select(ESTIMATE_ITEM_COLUMNS)
      .single();
    setBusy(false);
    if (err || !data) {
      // Carry the database's own words. The generic string hid a constraint
      // violation for as long as this button has existed.
      setError(`Could not add a line.${err?.message ? ` ${err.message}` : ""}`);
      return;
    }
    const row = fromRow(data);
    const next = sortItems([...items, row]);
    setItems(next);
    pendingFocus.current = row.id;
    syncProjectTotal(next, settings);
  }

  async function removeRow(item: EstimateItem) {
    const before = items;
    const next = items.filter((i) => i.id !== item.id);
    setItems(next);
    setError(null);
    const { error: err } = await createClient()
      .from("estimate_items")
      .delete()
      .eq("id", item.id);
    if (err) {
      setItems(before);
      setError("Could not delete that line.");
      return;
    }
    syncProjectTotal(next, settings);
  }

  // Moving a row is one UPDATE to a midpoint sort_order. When the gap between
  // two neighbours has closed, respace the whole project by 10s first.
  async function move(item: EstimateItem, dir: -1 | 1) {
    const at = ordered.findIndex((i) => i.id === item.id);
    const swapAt = at + dir;
    if (swapAt < 0 || swapAt >= ordered.length) return;

    const neighbour = ordered[swapAt];
    const beyond = ordered[swapAt + dir];
    const target =
      dir === -1
        ? midpointSortOrder(beyond?.sortOrder ?? null, neighbour.sortOrder)
        : midpointSortOrder(neighbour.sortOrder, beyond?.sortOrder ?? null);

    if (target == null) {
      await respace(ordered);
      return;
    }
    await patch(item, { sortOrder: target });
  }

  async function respace(rows: EstimateItem[]) {
    setBusy(true);
    const supabase = createClient();
    const renumbered = rows.map((i, idx) => ({ ...i, sortOrder: (idx + 1) * 10 }));
    const results = await Promise.all(
      renumbered.map((i) =>
        supabase
          .from("estimate_items")
          .update({ sort_order: i.sortOrder })
          .eq("id", i.id)
      )
    );
    setBusy(false);
    if (results.some((r) => r.error)) {
      setError("Could not reorder — reload and try again.");
      return;
    }
    setItems(renumbered);
  }

  async function saveTerms(value: string) {
    setError(null);
    const { error: err } = await createClient()
      .from("projects")
      .update({ estimate_terms: value.trim() || null })
      .eq("id", projectId);
    if (err) {
      setError("Could not save the terms for this estimate.");
      return;
    }
    flash("estimate_terms");
  }

  async function saveSetting(
    column: "tax_rate" | "deposit_percent" | "estimate_detail",
    value: number | string
  ) {
    const before = settings;
    const next: EstimateSettings = {
      ...settings,
      ...(column === "tax_rate" ? { taxRate: Number(value) } : {}),
      ...(column === "deposit_percent" ? { depositPercent: Number(value) } : {}),
      ...(column === "estimate_detail"
        ? { detail: value === "grouped" ? "grouped" : "itemized" }
        : {}),
    };
    setSettings(next);
    setError(null);
    const { error: err } = await createClient()
      .from("projects")
      .update({ [column]: value })
      .eq("id", projectId);
    if (err) {
      setSettings(before);
      setError("Could not save that setting.");
      return;
    }
    flash(column);
    syncProjectTotal(items, next);
  }

  /**
   * Push a price typed on an estimate up into the price book — the very grid
   * cell (plant and size) the Plant Prices page shows, which is what the
   * estimate and the headset both read. Owners keep the price book
   * (migration 007), so only they are offered it.
   */
  async function savePlantPrice(plantKey: string, size: string, price: number) {
    setError(null);
    const { error: err } = await createClient()
      .from("plant_prices")
      .upsert(
        { plant_key: plantKey, size, price },
        { onConflict: "user_id,plant_key,size" }
      );
    setPriceOffer(null);
    if (err) setError("Could not update the price book.");
  }

  async function saveToPriceBook(item: EstimateItem) {
    setError(null);
    // A labor-only line is saved as what it charges for.
    const labor = item.unitPrice === 0 && item.laborUnitPrice > 0;
    const { error: err } = await createClient().from("price_items").insert({
      name: item.description,
      category: labor ? "labor" : item.category,
      price: labor ? item.laborUnitPrice : item.unitPrice,
      unit: item.unit,
    });
    setError(err ? "Could not save to Saved Items." : null);
    if (!err) flash(`book-${item.id}`);
  }

  // Enter moves to the same column on the next row that has it, the way a
  // spreadsheet does. Below the last row there is nothing to move to, so a
  // new line starts instead.
  function enterDown(el: HTMLElement, rowIndex: number) {
    const col = el.dataset.col;
    el.blur();
    for (let r = rowIndex + 1; r < ordered.length; r++) {
      const next = document.querySelector<HTMLInputElement>(
        `[data-row="${r}"][data-col="${col}"]`
      );
      if (next) {
        next.focus();
        next.select?.();
        return;
      }
    }
    if (rowIndex === ordered.length - 1 && !readOnly) void addRow();
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper text-body">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-ink/20 bg-card px-4 py-2.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={`/dashboard/projects/${projectId}`}
            className="truncate text-sm text-muted transition hover:text-accent"
          >
            ← {projectName}
          </Link>
          <span className="h-4 w-px bg-ink/20" aria-hidden />
          <h1 className="text-sm font-semibold text-ink">Estimate</h1>
          {sample && (
            <span className="border border-gold/50 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-gold">
              Sample — read only
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {unpriced > 0 && (
            <span className="mr-1 text-[13px] font-semibold text-gold">
              {unpriced} {unpriced === 1 ? "line has" : "lines have"} no price
            </span>
          )}
          <a
            href={`/dashboard/projects/${projectId}/estimate/pdf?download=1`}
            className={BUTTON}
          >
            Download PDF
          </a>
          <a
            href={`/dashboard/projects/${projectId}/estimate/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className={BUTTON_PRIMARY}
          >
            Preview proposal
          </a>
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 py-5 sm:px-6">
        {children}
        {error && (
          <p className="border border-clay/50 bg-clay/[0.08] px-3 py-2 text-sm text-clay">
            {error}
          </p>
        )}

        {/* ── Line items ── */}
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted">
            Line items
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              disabled={readOnly}
              aria-expanded={pickerOpen}
              className={BUTTON}
            >
              From saved items
            </button>
            <button
              type="button"
              onClick={() => void addRow()}
              disabled={readOnly || busy}
              className={BUTTON}
            >
              Add line
            </button>
          </div>
        </div>

        {pickerOpen && (
          <SavedItemsPicker
            savedItems={savedItems}
            onPick={(s) =>
              void addRow({
                description: s.name,
                category: (CATEGORIES as readonly string[]).includes(s.category)
                  ? (s.category as EstimateCategory)
                  : "other",
                unit: s.unit,
                // A saved labor item charges labor, not material.
                ...(s.category === "labor"
                  ? { unitPrice: 0, laborUnitPrice: s.price }
                  : { unitPrice: s.price }),
              })
            }
          />
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse bg-card tabular-nums">
            <thead>
              <tr>
                <th className={`${TH} w-12 text-center`}>#</th>
                <th className={TH}>Item</th>
                <th className={`${TH} w-40`}>Category</th>
                <th className={`${TH} w-32 text-right`}>Qty</th>
                <th className={`${TH} w-28 text-right`}>Price</th>
                <th className={`${TH} w-28 text-right`}>Labor</th>
                <th className={`${TH} w-32 text-right`}>Amount</th>
                <th className={`${TH} w-14 text-center`} title="Taxes the material part only">
                  Tax
                </th>
                <th className={`${TH} w-28`}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ordered.length === 0 && (
                <tr>
                  <td colSpan={9} className={`${GRID} px-5 py-10 text-center text-sm text-muted`}>
                    No lines yet. Sync a design from the headset, or add the
                    first line by hand.
                  </td>
                </tr>
              )}
              {ordered.map((item, idx) => (
                <Row
                  key={item.id}
                  item={item}
                  index={idx}
                  count={ordered.length}
                  readOnly={readOnly}
                  isOwner={isOwner}
                  washing={wash === item.id}
                  noteOpen={notesOpen.has(item.id) || item.note != null}
                  registerRef={(el) => {
                    if (el && pendingFocus.current === item.id) {
                      pendingFocus.current = null;
                      el.focus();
                      // A new row arrives named NEW_LINE_DESCRIPTION; select
                      // it so the designer types straight over it.
                      if (el.value === NEW_LINE_DESCRIPTION) el.select();
                    }
                  }}
                  onPatch={(changes) => void patch(item, changes)}
                  onRemove={() => void removeRow(item)}
                  onMove={(dir) => void move(item, dir)}
                  onToggleNote={() =>
                    setNotesOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    })
                  }
                  onSaveToBook={() => void saveToPriceBook(item)}
                  onEnterDown={(el) => enterDown(el, idx)}
                />
              ))}
              {!readOnly && (
                <tr>
                  <td className={`${GRID} text-center text-xs text-faint`}>
                    {ordered.length + 1}
                  </td>
                  <td colSpan={8} className={TD}>
                    <button
                      type="button"
                      onClick={() => void addRow()}
                      disabled={busy}
                      className="block w-full px-2.5 py-2 text-left text-sm text-faint transition hover:bg-card-hover hover:text-accent"
                    >
                      Add a line
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {priceOffer && (
          <div className="flex flex-wrap items-center justify-between gap-3 border border-ink/20 bg-card px-4 py-2.5">
            <p className="text-sm text-body">
              Save{" "}
              <span className="font-semibold tabular-nums">
                {currency.format(priceOffer.price)}
              </span>{" "}
              as your price for{" "}
              <span className="font-semibold">
                {priceOffer.plantName} ({priceOffer.size})
              </span>
              ?<span className="text-muted"> It will apply to new estimates.</span>
            </p>
            <span className="flex items-center gap-2">
              <button type="button" onClick={() => setPriceOffer(null)} className={BUTTON}>
                Not now
              </button>
              <button
                type="button"
                onClick={() =>
                  void savePlantPrice(priceOffer.plantKey, priceOffer.size, priceOffer.price)
                }
                className={BUTTON_PRIMARY}
              >
                Save to price book
              </button>
            </span>
          </div>
        )}

        {/* ── Proposal settings (left) and totals (right), QuickBooks-style ── */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <Proposal
            detail={settings.detail}
            onDetailChange={(d) => void saveSetting("estimate_detail", d)}
            terms={initialTerms}
            onTermsSave={(v) => void saveTerms(v)}
            readOnly={readOnly}
            washing={wash === "estimate_terms"}
          />
          <Totals
            settings={settings}
            totals={totals}
            readOnly={readOnly}
            washing={wash}
            onRate={(v) => void saveSetting("tax_rate", v)}
            onDeposit={(v) => void saveSetting("deposit_percent", v)}
          />
        </div>

        <p className="text-xs text-faint">
          The total syncs back to the project, so the dashboard card and this
          bid always agree.
        </p>
      </main>
    </div>
  );
}

/* ── One row ──────────────────────────────────────────────────────────── */

type Draft = {
  stamp: string;
  description: string;
  quantity: string;
  price: string;
  labor: string;
  note: string;
};

// Identity of a row's committed values. When this changes, the drafts below
// are stale and get reseeded.
const stampOf = (i: EstimateItem) =>
  [i.description, i.quantity, i.unitPrice, i.laborUnitPrice, i.note ?? ""].join("\u0000");

// A manual line with no labor shows a blank Labor cell rather than 0.00 —
// most hand-typed lines are pure material, and a column of zeros is noise.
const seedDraft = (i: EstimateItem): Draft => ({
  stamp: stampOf(i),
  description: i.description,
  quantity: String(i.quantity),
  price: i.unitPrice.toFixed(2),
  labor: i.source === "manual" && i.laborUnitPrice === 0 ? "" : i.laborUnitPrice.toFixed(2),
  note: i.note ?? "",
});

function CubeMark() {
  return (
    <svg viewBox="0 0 16 16" className="mx-auto h-3.5 w-3.5 text-accent" aria-hidden>
      <path
        d="M8 1.5 14 4.75v6.5L8 14.5 2 11.25v-6.5L8 1.5Zm0 0v6.25m0 0 6-3m-6 3-6-3m6 3v6.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Row({
  item,
  index,
  count,
  readOnly,
  isOwner,
  washing,
  noteOpen,
  registerRef,
  onPatch,
  onRemove,
  onMove,
  onToggleNote,
  onSaveToBook,
  onEnterDown,
}: {
  item: EstimateItem;
  index: number;
  count: number;
  readOnly: boolean;
  isOwner: boolean;
  washing: boolean;
  noteOpen: boolean;
  registerRef: (el: HTMLInputElement | null) => void;
  onPatch: (changes: Partial<EstimateItem>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onToggleNote: () => void;
  onSaveToBook: () => void;
  onEnterDown: (el: HTMLElement) => void;
}) {
  const fromDesign = item.source === "ar";
  const unpriced = isUnpriced(item);

  // Text lives in local drafts while it's being typed and commits on blur, so
  // a slow round-trip never eats a keystroke. When the committed row changes
  // underneath — an optimistic patch landing, or a failed save rolling back —
  // the drafts resync during render.
  const [draft, setDraft] = useState(() => seedDraft(item));
  const stamp = stampOf(item);
  if (draft.stamp !== stamp) setDraft(seedDraft(item));
  const edit = (changes: Partial<Omit<Draft, "stamp">>) =>
    setDraft((d) => ({ ...d, ...changes }));

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    onEnterDown(e.currentTarget);
  };
  // Lets Enter find this row's cell in the same column on the next row.
  const cellProps = (col: string) => ({
    "data-row": index,
    "data-col": col,
    onKeyDown: onKey,
  });

  // Money cells: blank or invalid snaps back, except Labor, where blank is 0.
  const commitMoney = (
    raw: string,
    current: number,
    reset: () => void,
    apply: (n: number) => void,
    blankIsZero = false
  ) => {
    const text = raw.trim();
    const n = text === "" && blankIsZero ? 0 : Number(text);
    if ((text === "" && !blankIsZero) || Number.isNaN(n) || n < 0) {
      reset();
      return;
    }
    if (round2(n) === round2(current)) {
      reset();
      return;
    }
    apply(round2(n));
  };

  const rowTint = unpriced ? "bg-gold/[0.07]" : "";

  return (
    <>
      <tr className={`group ${washing ? "save-wash" : rowTint}`}>
        <td
          className={`${GRID} text-center text-xs text-faint`}
          title={fromDesign ? "From the design — a headset resync rewrites this line" : undefined}
        >
          {fromDesign ? <CubeMark /> : index + 1}
        </td>

        <td className={TD}>
          {fromDesign ? (
            <span className={`${TEXT_CELL} truncate text-ink`}>{item.description}</span>
          ) : (
            <input
              ref={registerRef}
              {...cellProps("desc")}
              value={draft.description}
              disabled={readOnly}
              onChange={(e) => edit({ description: e.target.value })}
              onBlur={() => {
                const v = draft.description.trim();
                if (v === item.description) return;
                if (v === "") {
                  edit({ description: item.description });
                  return;
                }
                onPatch({ description: v });
              }}
              placeholder="Describe the work"
              aria-label="Item"
              className={INPUT}
            />
          )}
        </td>

        <td className={TD}>
          {fromDesign ? (
            <span className={`${TEXT_CELL} text-muted`}>{CATEGORY_LABELS[item.category]}</span>
          ) : (
            <select
              value={item.category}
              disabled={readOnly}
              onChange={(e) => onPatch({ category: e.target.value as EstimateCategory })}
              aria-label="Category"
              className={`${INPUT} cursor-pointer appearance-none disabled:cursor-default`}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          )}
        </td>

        <td className={TD}>
          {fromDesign ? (
            // The design owns the count — change it in the headset or the 3D
            // viewer, which is what rebuilds these rows.
            <span
              className={`${TEXT_CELL} text-right`}
              title="Set by the design — change it in the headset or the 3D viewer"
            >
              {qtyLabel(item)}
            </span>
          ) : (
            <div className="flex items-center">
              <input
                {...cellProps("qty")}
                type="number"
                min="0"
                step="0.01"
                value={draft.quantity}
                disabled={readOnly}
                onChange={(e) => edit({ quantity: e.target.value })}
                onBlur={() =>
                  commitMoney(
                    draft.quantity,
                    item.quantity,
                    () => edit({ quantity: String(item.quantity) }),
                    (n) => onPatch({ quantity: n })
                  )
                }
                aria-label="Quantity"
                className={`${INPUT} no-spinner text-right`}
              />
              {item.unit && item.unit !== "each" && item.unit !== "ls" && (
                <span className="pr-2.5 text-xs text-muted">{item.unit}</span>
              )}
            </div>
          )}
        </td>

        <td className={TD}>
          <input
            {...cellProps("price")}
            type="number"
            min="0"
            step="0.01"
            value={draft.price}
            disabled={readOnly}
            onChange={(e) => edit({ price: e.target.value })}
            onBlur={() =>
              commitMoney(
                draft.price,
                item.unitPrice,
                () => edit({ price: item.unitPrice.toFixed(2) }),
                (n) => onPatch({ unitPrice: n })
              )
            }
            aria-label="Price"
            title={
              unpriced
                ? "No price in your Prices grid — this line is $0 until you add one"
                : item.priceOverridden
                  ? "Typed over the price book — a resync keeps this price"
                  : undefined
            }
            className={`${INPUT} no-spinner text-right ${
              unpriced
                ? "font-semibold text-gold"
                : item.priceOverridden
                  ? "font-semibold text-accent-dim"
                  : ""
            }`}
          />
        </td>

        <td className={TD}>
          <input
            {...cellProps("labor")}
            type="number"
            min="0"
            step="0.01"
            value={draft.labor}
            disabled={readOnly}
            onChange={(e) => edit({ labor: e.target.value })}
            onBlur={() =>
              commitMoney(
                draft.labor,
                item.laborUnitPrice,
                () => edit({ labor: seedDraft(item).labor }),
                (n) => onPatch({ laborUnitPrice: n }),
                true
              )
            }
            placeholder={fromDesign ? "0.00" : "—"}
            aria-label="Labor"
            title={
              item.laborOverridden
                ? "Typed over your labor rate — a resync keeps this labor"
                : undefined
            }
            className={`${INPUT} no-spinner text-right ${
              item.laborOverridden ? "font-semibold text-accent-dim" : ""
            }`}
          />
        </td>

        <td className={`${GRID} px-2.5 py-2 text-right text-sm font-semibold text-ink`}>
          {amount.format(item.total)}
        </td>

        <td className={`${GRID} text-center`}>
          <input
            type="checkbox"
            checked={item.taxable}
            disabled={readOnly}
            onChange={(e) => onPatch({ taxable: e.target.checked })}
            aria-label="Taxable"
            className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)] disabled:cursor-default"
          />
        </td>

        <td className={`${GRID} px-1.5`}>
          {/* Out of the way until the row is pointed at — the grid stays a
              grid, and every control is still a Tab away. */}
          <div className="flex items-center justify-end gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
            <IconButton
              label="Move line up"
              onClick={() => onMove(-1)}
              disabled={readOnly || index === 0}
            >
              ↑
            </IconButton>
            <IconButton
              label="Move line down"
              onClick={() => onMove(1)}
              disabled={readOnly || index === count - 1}
            >
              ↓
            </IconButton>
            <IconButton
              label={noteOpen ? "Hide note" : "Add a note"}
              onClick={onToggleNote}
              disabled={readOnly}
            >
              ✎
            </IconButton>
            {isOwner && !fromDesign && (
              <IconButton
                label="Save to Saved Items"
                onClick={onSaveToBook}
                disabled={readOnly || item.description.trim() === ""}
              >
                ★
              </IconButton>
            )}
            {!fromDesign && (
              <IconButton label="Delete line" onClick={onRemove} disabled={readOnly} danger>
                ✕
              </IconButton>
            )}
          </div>
        </td>
      </tr>

      {noteOpen && (
        <tr className={rowTint}>
          <td className={GRID} />
          <td colSpan={8} className={TD}>
            <input
              value={draft.note}
              disabled={readOnly}
              onChange={(e) => edit({ note: e.target.value })}
              onBlur={() => {
                const v = draft.note.trim();
                if (v === (item.note ?? "")) return;
                onPatch({ note: v === "" ? null : v });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              placeholder="Scope note — prints under this line on the itemized proposal"
              aria-label="Line note"
              className={`${INPUT} h-8 text-[0.82rem] italic text-muted`}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`h-6 w-6 text-xs text-muted transition disabled:opacity-25 ${
        danger ? "hover:text-clay" : "hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}

/* ── Saved Items picker ───────────────────────────────────────────────── */

function SavedItemsPicker({
  savedItems,
  onPick,
}: {
  savedItems: SavedItem[];
  onPick: (item: SavedItem) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? savedItems.filter(
        (s) => s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
      )
    : savedItems;

  return (
    <div className="border border-ink/20 bg-card px-4 py-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search saved items"
        aria-label="Search saved items"
        className="w-full max-w-sm border border-ink/25 bg-card-hover px-3 py-1.5 text-sm text-body outline-none placeholder:text-faint focus:outline-2 focus:-outline-offset-2 focus:outline-accent"
      />
      {savedItems.length === 0 ? (
        <p className="mt-3 max-w-lg text-sm text-muted">
          No saved items yet. An org owner can build this list from the price
          book — or add a line below and click ★ to keep it for next time.
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {shown.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s)}
                className="border border-ink/20 bg-card px-3 py-1.5 text-left text-[13px] text-body transition hover:border-accent hover:bg-card-hover"
              >
                <span className="font-medium text-ink">{s.name}</span>
                <span className="ml-2 text-xs tabular-nums text-muted">
                  {currency.format(s.price)}/{s.unit}
                </span>
              </button>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="text-sm text-muted">Nothing matches “{query}”.</li>
          )}
        </ul>
      )}
    </div>
  );
}

/* ── Proposal: what the client sees, and the terms that print with it ──── */

function Proposal({
  detail,
  onDetailChange,
  terms,
  onTermsSave,
  readOnly,
  washing,
}: {
  detail: EstimateSettings["detail"];
  onDetailChange: (d: EstimateSettings["detail"]) => void;
  terms: string | null;
  onTermsSave: (value: string) => void;
  readOnly: boolean;
  washing: boolean;
}) {
  return (
    <section className="border border-ink/20 bg-card">
      <h2 className="border-b border-ink/20 bg-paper-deep px-2.5 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted">
        Proposal
      </h2>
      <div className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">The client sees</span>
          <div role="group" aria-label="Client PDF detail" className="flex border border-ink/25">
            {(
              [
                ["itemized", "Itemized"],
                ["grouped", "Lump sums"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                disabled={readOnly}
                aria-pressed={detail === value}
                onClick={() => onDetailChange(value)}
                className={`px-3 py-1 text-[13px] font-semibold transition ${
                  detail === value ? "bg-accent text-paper" : "text-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-xs text-faint">
            {detail === "itemized"
              ? "Every line, priced installed (material and labor together)."
              : "Category totals only — lines and prices stay internal."}
          </span>
        </div>
        <label className="block">
          <span className="text-sm text-muted">Terms for this estimate</span>
          <textarea
            defaultValue={terms ?? ""}
            disabled={readOnly}
            onBlur={(e) => onTermsSave(e.target.value)}
            rows={4}
            placeholder="Leave blank to print your company terms."
            className={`mt-1 block w-full border border-ink/25 bg-card-hover px-2.5 py-2 text-sm text-body outline-none placeholder:text-faint focus:outline-2 focus:-outline-offset-2 focus:outline-accent ${
              washing ? "save-wash" : ""
            }`}
          />
        </label>
        <p className="text-xs text-faint">Prints under your company&apos;s letterhead.</p>
      </div>
    </section>
  );
}

/* ── Totals ───────────────────────────────────────────────────────────── */

function Totals({
  settings,
  totals,
  readOnly,
  washing,
  onRate,
  onDeposit,
}: {
  settings: EstimateSettings;
  totals: ReturnType<typeof computeTotals>;
  readOnly: boolean;
  washing: string | null;
  onRate: (v: number) => void;
  onDeposit: (v: number) => void;
}) {
  // Same draft-resync-during-render pattern as the rows: the percentage
  // fields are text while they're being typed and follow the saved settings
  // whenever those change.
  const stamp = `${settings.taxRate}\u0000${settings.depositPercent}`;
  const [pcts, setPcts] = useState(() => ({
    stamp,
    rate: String(settings.taxRate),
    dep: String(settings.depositPercent),
  }));
  if (pcts.stamp !== stamp) {
    setPcts({ stamp, rate: String(settings.taxRate), dep: String(settings.depositPercent) });
  }
  const { rate, dep } = pcts;
  const setRate = (v: string) => setPcts((p) => ({ ...p, rate: v }));
  const setDep = (v: string) => setPcts((p) => ({ ...p, dep: v }));

  const pct = (raw: string, current: number, reset: (v: string) => void, apply: (n: number) => void) => {
    const n = Number(raw);
    if (raw.trim() === "" || Number.isNaN(n) || n < 0 || n > 100) {
      reset(String(current));
      return;
    }
    if (n === current) return;
    apply(n);
  };

  const pctInput =
    "no-spinner w-16 border border-ink/25 bg-card-hover px-1.5 py-0.5 text-right text-sm tabular-nums text-body outline-none focus:outline-2 focus:-outline-offset-2 focus:outline-accent disabled:opacity-60";
  const nameCell = `${GRID} px-2.5 py-2 text-sm text-muted`;
  const valueCell = `${GRID} px-2.5 py-2 text-right text-sm text-body`;

  return (
    <table className="h-fit w-full border-collapse bg-card tabular-nums">
      <tbody>
        <tr>
          <td className={nameCell}>Subtotal</td>
          <td className={valueCell}>{amount.format(totals.subtotal)}</td>
        </tr>
        {totals.laborSubtotal > 0 && (
          <tr>
            <td className={`${nameCell} pl-6 text-xs text-faint`}>includes labor</td>
            <td className={`${valueCell} text-xs text-faint`}>{amount.format(totals.laborSubtotal)}</td>
          </tr>
        )}
        <tr className={washing === "tax_rate" ? "save-wash" : ""}>
          <td className={nameCell}>
            <span className="flex items-center gap-1.5">
              <label htmlFor="tax-rate">Tax</label>
              <input
                id="tax-rate"
                type="number"
                min="0"
                max="100"
                step="0.001"
                value={rate}
                disabled={readOnly}
                onChange={(e) => setRate(e.target.value)}
                onBlur={() => pct(rate, settings.taxRate, setRate, onRate)}
                className={pctInput}
              />
              <span className="text-faint">% on materials</span>
            </span>
          </td>
          <td className={valueCell}>{amount.format(totals.tax)}</td>
        </tr>
        <tr className="bg-paper-deep">
          <td className={`${GRID} px-2.5 py-2.5 text-sm font-semibold text-ink`}>Total</td>
          <td className={`${GRID} px-2.5 py-2.5 text-right text-base font-semibold text-ink`}>
            {currency.format(totals.total)}
          </td>
        </tr>
        <tr className={washing === "deposit_percent" ? "save-wash" : ""}>
          <td className={nameCell}>
            <span className="flex items-center gap-1.5">
              <label htmlFor="deposit-pct">Deposit</label>
              <input
                id="deposit-pct"
                type="number"
                min="0"
                max="100"
                step="1"
                value={dep}
                disabled={readOnly}
                onChange={(e) => setDep(e.target.value)}
                onBlur={() => pct(dep, settings.depositPercent, setDep, onDeposit)}
                className={pctInput}
              />
              <span className="text-faint">%</span>
            </span>
          </td>
          <td className={valueCell}>{amount.format(totals.deposit)}</td>
        </tr>
        <tr>
          <td className={nameCell}>Balance on completion</td>
          <td className={valueCell}>{amount.format(totals.balance)}</td>
        </tr>
      </tbody>
    </table>
  );
}
