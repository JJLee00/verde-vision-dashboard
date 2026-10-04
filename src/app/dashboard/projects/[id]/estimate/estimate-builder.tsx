"use client";

// The estimate row table. Same editing grammar as the Prices tab and the
// project record: commit on blur, optimistic update, roll back and explain on
// error, green wash on success. No drag-and-drop library — rows move with
// ↑/↓ buttons, which are keyboard- and touch-reachable and don't fight the
// inputs for pointer events.
//
// Two row kinds, and the difference is the whole feature:
//   • source 'ar'     — written by the design. A headset resync rewrites
//                       these, so description/category/unit are fixed here.
//                       Editing the price sets price_overridden, which tells
//                       the resync to update the QUANTITY and leave the price
//                       alone.
//   • source 'manual' — typed here. A resync never touches them.

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { plantForKey } from "@/lib/design-edit";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  UNITS,
  computeTotals,
  lineTotal,
  midpointSortOrder,
  nextSortOrder,
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

const SELECT_COLUMNS =
  "id, sort_order, description, category, quantity, unit, unit_price, total, taxable, note, source, ar_key, price_overridden";

// What a brand-new manual line is called before the designer names it. The
// editor was written for a row that starts empty — the input still carries a
// "Describe the work…" placeholder — but estimate_items forbids an empty
// description, so the row is born named and the name is selected for typing.
const NEW_LINE_DESCRIPTION = "New line";

const cell =
  "w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm text-body outline-none transition placeholder:text-faint hover:border-rule focus:border-accent focus:bg-card-hover focus:ring-2 focus:ring-accent-soft disabled:cursor-default disabled:hover:border-transparent";

export function EstimateBuilder({
  projectId,
  initialItems,
  initialSettings,
  initialTerms,
  savedItems,
  canEdit,
  isOwner,
}: {
  projectId: string;
  initialItems: EstimateItem[];
  initialSettings: EstimateSettings;
  initialTerms: string;
  savedItems: SavedItem[];
  canEdit: boolean;
  isOwner: boolean;
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
  // moment it mounts — the difference between "add a line" and actually
  // typing a 40-row bid. Done in the ref callback, not an effect: the input
  // doesn't exist yet when the row is created.
  const pendingFocus = useRef<string | null>(null);

  const totals = computeTotals(items, settings);

  function flash(key: string) {
    setWash(key);
    setTimeout(() => setWash((w) => (w === key ? null : w)), 1000);
  }

  // Keep projects.estimate_amount derived rather than hand-set, so the
  // project card and the bid can never disagree. Fire-and-forget: a failure
  // here is a stale card, not lost work, and the next edit retries it.
  function syncProjectTotal(nextItems: EstimateItem[], next: EstimateSettings) {
    const amount = computeTotals(nextItems, next).total;
    void createClient()
      .from("projects")
      .update({ estimate_amount: amount })
      .eq("id", projectId);
  }

  async function patch(item: EstimateItem, changes: Partial<EstimateItem>) {
    const before = items;
    const merged: EstimateItem = { ...item, ...changes };
    merged.total = lineTotal(merged);
    const next = items.map((i) => (i.id === item.id ? merged : i));
    setItems(next);
    setError(null);

    const payload: Record<string, unknown> = {};
    if ("description" in changes) payload.description = merged.description;
    if ("category" in changes) payload.category = merged.category;
    if ("quantity" in changes) payload.quantity = merged.quantity;
    if ("unit" in changes) payload.unit = merged.unit;
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
    if ("taxable" in changes) payload.taxable = merged.taxable;
    if ("note" in changes) payload.note = merged.note;
    if ("sortOrder" in changes) payload.sort_order = merged.sortOrder;

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
        // Not "" — estimate_items requires length(trim(description)) > 0,
        // so a blank new line is rejected outright by the database and the
        // button silently did nothing. The row is created named instead, and
        // the input selects this text on focus so typing replaces it.
        description: seed?.description ?? NEW_LINE_DESCRIPTION,
        category: seed?.category ?? "other",
        quantity: seed?.quantity ?? 1,
        unit: seed?.unit ?? "each",
        unit_price: seed?.unitPrice ?? 0,
        taxable: seed?.taxable ?? true,
        source: "manual",
      })
      .select(SELECT_COLUMNS)
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
    const ordered = sortItems(items);
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

  async function respace(ordered: EstimateItem[]) {
    setBusy(true);
    const supabase = createClient();
    const renumbered = ordered.map((i, idx) => ({
      ...i,
      sortOrder: (idx + 1) * 10,
    }));
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
      ...(column === "deposit_percent"
        ? { depositPercent: Number(value) }
        : {}),
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

  // Owners keep the price book (migration 007), so only they can add to it.
  /**
   * Push a price typed on an estimate up into the price book — the very grid
   * cell (plant and size) the Plant Prices page shows, which is what
   * rebuildPlantRows and the headset both read. It wrote the legacy
   * name-only price_items until Oct 4 2026, which nothing priced from any
   * more, so the offer saved a price no estimate would ever use.
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
    const { error: err } = await createClient().from("price_items").insert({
      name: item.description,
      category: item.category,
      price: item.unitPrice,
      unit: item.unit,
    });
    setError(
      err ? "Could not save to Saved Items." : null
    );
    if (!err) flash(`book-${item.id}`);
  }

  const readOnly = !canEdit;

  return (
    <div className="mt-7">
      {error && (
        <p className="mb-4 rounded-lg border border-clay/40 bg-clay/[0.08] px-4 py-2.5 text-sm text-clay">
          {error}
        </p>
      )}

      <section className="rounded-[14px] border border-edge bg-card shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-4">
          <h2 className="font-serif text-2xl text-ink">Line items</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              disabled={readOnly}
              aria-expanded={pickerOpen}
              className="rounded-lg border border-rule-strong bg-paper-deep px-3 py-1.5 text-[13px] font-semibold text-ink transition hover:bg-card-hover disabled:opacity-50"
            >
              From Saved Items
            </button>
            <button
              type="button"
              onClick={() => void addRow()}
              disabled={readOnly || busy}
              className="rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-paper transition hover:bg-accent-bright disabled:opacity-50"
            >
              + Add line
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
                unitPrice: s.price,
                taxable: s.category !== "labor",
              })
            }
          />
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="border-b border-rule text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-faint">
                <th className="w-8 px-2 py-2.5" aria-label="Order" />
                <th className="px-2 py-2.5">Item</th>
                <th className="w-[11.5rem] px-2 py-2.5">Category</th>
                <th className="w-20 px-2 py-2.5 text-right">Qty</th>
                <th className="w-24 px-2 py-2.5">Unit</th>
                <th className="w-28 px-2 py-2.5 text-right">Unit price</th>
                <th className="w-28 px-2 py-2.5 text-right">Total</th>
                <th className="w-12 px-2 py-2.5 text-center" title="Taxable">
                  Tax
                </th>
                <th className="w-24 px-2 py-2.5" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center">
                    <p className="text-sm text-muted">
                      No line items yet. Sync a design from the headset, or add
                      the first line by hand.
                    </p>
                  </td>
                </tr>
              )}
              {sortItems(items).map((item, idx) => (
                <Row
                  key={item.id}
                  item={item}
                  index={idx}
                  count={items.length}
                  readOnly={readOnly}
                  isOwner={isOwner}
                  washing={wash === item.id}
                  noteOpen={notesOpen.has(item.id) || item.note != null}
                  registerRef={(el) => {
                    if (el && pendingFocus.current === item.id) {
                      pendingFocus.current = null;
                      el.focus();
                      // A new row arrives carrying NEW_LINE_DESCRIPTION
                      // rather than "", so select it: the designer types
                      // straight over it exactly as they would an empty
                      // field, instead of clearing it first.
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
                  onEnterAtEnd={() => void addRow()}
                />
              ))}
            </tbody>
          </table>
        </div>

        {priceOffer && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-5 py-3">
            <p className="text-sm text-body">
              Save{" "}
              <span className="font-mono font-semibold">
                {currency.format(priceOffer.price)}
              </span>{" "}
              as your price for{" "}
              <span className="font-semibold">
                {priceOffer.plantName} ({priceOffer.size})
              </span>
              ?
              <span className="text-muted"> It will apply to new estimates.</span>
            </p>
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPriceOffer(null)}
                className="rounded-lg border border-edge px-3 py-1.5 text-[13px] font-semibold text-body transition hover:bg-paper-deep"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={() =>
                  void savePlantPrice(
                    priceOffer.plantKey,
                    priceOffer.size,
                    priceOffer.price
                  )
                }
                className="rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-paper transition hover:bg-accent-bright"
              >
                Save to price book
              </button>
            </span>
          </div>
        )}
      </section>

      {/* The "What the client sees" and Terms cards are gone — two panels of
          explanation for two controls. The controls themselves moved into
          Totals, which is where every other decision about the printed
          proposal already lives. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div />
        <Totals
          detail={settings.detail}
          onDetailChange={(d) => void saveSetting("estimate_detail", d)}
          terms={initialTerms}
          onTermsSave={(v) => void saveTerms(v)}
          projectId={projectId}
          settings={settings}
          totals={totals}
          readOnly={readOnly}
          washing={wash}
          onRate={(v) => void saveSetting("tax_rate", v)}
          onDeposit={(v) => void saveSetting("deposit_percent", v)}
        />
      </div>
    </div>
  );
}

/* ── One row ──────────────────────────────────────────────────────────── */

type Draft = {
  stamp: string;
  description: string;
  quantity: string;
  price: string;
  note: string;
};

// Identity of a row's committed values. When this changes, the drafts below
// are stale and get reseeded.
const stampOf = (i: EstimateItem) =>
  [i.description, i.quantity, i.unitPrice, i.note ?? ""].join("\u0000");

const seedDraft = (i: EstimateItem): Draft => ({
  stamp: stampOf(i),
  description: i.description,
  quantity: String(i.quantity),
  price: i.unitPrice.toFixed(2),
  note: i.note ?? "",
});


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
  onEnterAtEnd,
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
  onEnterAtEnd: () => void;
}) {
  const fromDesign = item.source === "ar";

  // Text lives in local drafts while it's being typed and commits on blur, so
  // a slow round-trip never eats a keystroke. When the committed row changes
  // underneath — an optimistic patch landing, or a failed save rolling back —
  // the drafts resync during render. Resetting all four together is safe
  // because only one cell can be focused at a time and blur commits it first.
  const [draft, setDraft] = useState(() => seedDraft(item));
  const stamp = stampOf(item);
  if (draft.stamp !== stamp) setDraft(seedDraft(item));
  const { description: desc, quantity: qty, price, note } = draft;
  const edit = (changes: Partial<Omit<Draft, "stamp">>) =>
    setDraft((d) => ({ ...d, ...changes }));

  const isLast = index === count - 1;
  // Enter commits the cell; on the last row it also starts the next line, so
  // a long bid can be typed without reaching for the mouse.
  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).blur();
    if (isLast) onEnterAtEnd();
  };

  const commitNumber = (
    raw: string,
    current: number,
    reset: (v: string) => void,
    apply: (n: number) => void
  ) => {
    const n = Number(raw);
    if (raw.trim() === "" || Number.isNaN(n) || n < 0) {
      reset(current.toString());
      return;
    }
    if (round2(n) === round2(current)) return;
    apply(round2(n));
  };

  return (
    <>
      <tr
        className={`border-b border-rule/60 align-middle ${
          washing ? "save-wash" : ""
        } ${index % 2 === 0 ? "" : "bg-ink/[0.015]"}`}
      >
        <td className="px-1 py-1.5">
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={readOnly || index === 0}
              aria-label="Move line up"
              className="h-4 leading-none text-faint transition hover:text-accent disabled:opacity-25"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={readOnly || index === count - 1}
              aria-label="Move line down"
              className="h-4 leading-none text-faint transition hover:text-accent disabled:opacity-25"
            >
              ▼
            </button>
          </div>
        </td>

        <td className="px-2 py-1.5">
          <div className="flex items-center gap-2">
            <input
              ref={registerRef}
              value={desc}
              disabled={readOnly || fromDesign}
              onChange={(e) => edit({ description: e.target.value })}
              onBlur={() => {
                const v = desc.trim();
                if (v === item.description) return;
                if (v === "") {
                  edit({ description: item.description });
                  return;
                }
                onPatch({ description: v });
              }}
              onKeyDown={onKey}
              placeholder="Describe the work…"
              aria-label="Item description"
              className={`${cell} ${fromDesign ? "font-medium text-ink" : ""}`}
            />
            {fromDesign && (
              <span
                title="Written by the AR design. A headset resync rewrites this line."
                className="shrink-0 rounded-full border border-accent/30 bg-accent-soft/40 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-accent-dim"
              >
                design
              </span>
            )}
          </div>
        </td>

        <td className="px-2 py-1.5">
          <select
            value={item.category}
            disabled={readOnly || fromDesign}
            onChange={(e) =>
              onPatch({ category: e.target.value as EstimateCategory })
            }
            aria-label="Category"
            className={`${cell} cursor-pointer appearance-none disabled:cursor-default`}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </td>

        <td className="px-2 py-1.5">
          <input
            type="number"
            min="0"
            step="0.01"
            value={qty}
            // Locked on a design row. rebuildPlantRows sets `quantity`
            // unconditionally on every resync — only the PRICE is protected,
            // by price_overridden — so an edit here was accepted and then
            // silently thrown away the next time the headset synced or the
            // office published. The design owns the count; change it in the
            // headset or the 3D viewer, which is what rebuilds these rows.
            disabled={readOnly || fromDesign}
            title={
              fromDesign
                ? "Set by the design — change it in the headset or the 3D viewer"
                : undefined
            }
            onChange={(e) => edit({ quantity: e.target.value })}
            onBlur={() =>
              commitNumber(
                qty,
                item.quantity,
                (v) => edit({ quantity: v }),
                (n) => onPatch({ quantity: n })
              )
            }
            onKeyDown={onKey}
            aria-label="Quantity"
            className={`${cell} no-spinner text-right tabular-nums`}
          />
        </td>

        <td className="px-2 py-1.5">
          <select
            value={item.unit}
            disabled={readOnly || fromDesign}
            onChange={(e) => onPatch({ unit: e.target.value })}
            aria-label="Unit"
            className={`${cell} cursor-pointer appearance-none disabled:cursor-default`}
          >
            {(UNITS as readonly string[]).includes(item.unit) ? null : (
              <option value={item.unit}>{item.unit}</option>
            )}
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </td>

        <td className="px-2 py-1.5">
          <div className="relative">
            <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-sm text-faint">
              $
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              disabled={readOnly}
              onChange={(e) => edit({ price: e.target.value })}
              onBlur={() =>
                commitNumber(
                  price,
                  item.unitPrice,
                  (v) => edit({ price: v }),
                  (n) => onPatch({ unitPrice: n })
                )
              }
              onKeyDown={onKey}
              aria-label="Unit price"
              title={
                item.priceOverridden
                  ? "Typed over the price book — a resync keeps this price."
                  : undefined
              }
              className={`${cell} no-spinner pl-4 text-right tabular-nums ${
                item.priceOverridden ? "font-semibold text-accent-dim" : ""
              }`}
            />
          </div>
        </td>

        <td className="px-2 py-1.5 text-right font-mono text-sm font-semibold tabular-nums text-ink">
          {currency.format(item.total)}
        </td>

        <td className="px-2 py-1.5 text-center">
          <input
            type="checkbox"
            checked={item.taxable}
            disabled={readOnly}
            onChange={(e) => onPatch({ taxable: e.target.checked })}
            aria-label="Taxable"
            className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)] disabled:cursor-default"
          />
        </td>

        <td className="px-2 py-1.5">
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={onToggleNote}
              disabled={readOnly}
              aria-label={noteOpen ? "Hide note" : "Add a note"}
              title="Scope note — prints under this line"
              className="rounded px-1.5 py-0.5 text-xs text-muted transition hover:text-accent disabled:opacity-30"
            >
              note
            </button>
            {isOwner && !fromDesign && (
              <button
                type="button"
                onClick={onSaveToBook}
                disabled={readOnly || item.description.trim() === ""}
                aria-label="Save to Saved Items"
                title="Save to Saved Items so it's one click next time"
                className="rounded px-1 py-0.5 text-xs text-muted transition hover:text-accent disabled:opacity-30"
              >
                ★
              </button>
            )}
            <button
              type="button"
              onClick={onRemove}
              // AR rows belong to the design: removing a plant is a design
              // change, made in the headset (or, later, the dashboard editor).
              disabled={readOnly || fromDesign}
              aria-label="Delete line"
              title={
                fromDesign
                  ? "Comes from the design — remove the plant in the headset"
                  : "Delete this line"
              }
              className="rounded px-1 py-0.5 text-xs text-muted transition hover:text-clay disabled:opacity-25"
            >
              ✕
            </button>
          </div>
        </td>
      </tr>

      {noteOpen && (
        <tr className={index % 2 === 0 ? "" : "bg-ink/[0.015]"}>
          <td />
          <td colSpan={8} className="px-2 pb-2.5">
            <input
              value={note}
              disabled={readOnly}
              onChange={(e) => edit({ note: e.target.value })}
              onBlur={() => {
                const v = note.trim();
                if (v === (item.note ?? "")) return;
                onPatch({ note: v === "" ? null : v });
              }}
              onKeyDown={onKey}
              placeholder="Scope note — prints under this line on the itemized PDF"
              aria-label="Line note"
              className={`${cell} border-rule/60 bg-card-hover/60 text-[0.82rem] italic text-muted`}
            />
          </td>
        </tr>
      )}
    </>
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
        (s) =>
          s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
      )
    : savedItems;

  return (
    <div className="border-b border-rule bg-paper-deep/50 px-5 py-4">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search saved items…"
        aria-label="Search saved items"
        className="w-full max-w-sm rounded-lg border border-rule bg-card-hover px-3 py-2 text-sm text-body outline-none transition placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
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
                className="rounded-lg border border-rule bg-card px-3 py-1.5 text-left text-[13px] text-body transition hover:border-accent hover:bg-card-hover"
              >
                <span className="font-medium text-ink">{s.name}</span>
                <span className="ml-2 font-mono text-xs tabular-nums text-muted">
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


/* ── Totals ───────────────────────────────────────────────────────────── */

function Totals({
  projectId,
  settings,
  totals,
  readOnly,
  washing,
  onRate,
  onDeposit,
  detail,
  onDetailChange,
  terms,
  onTermsSave,
}: {
  projectId: string;
  settings: EstimateSettings;
  totals: ReturnType<typeof computeTotals>;
  readOnly: boolean;
  washing: string | null;
  onRate: (v: number) => void;
  onDeposit: (v: number) => void;
  // Moved in from the two cards that used to sit beside this one: both are
  // decisions about the printed proposal, and this is where the proposal is
  // generated.
  detail: EstimateSettings["detail"];
  onDetailChange: (d: EstimateSettings["detail"]) => void;
  terms: string | null;
  onTermsSave: (value: string) => void;
}) {
  const [termsOpen, setTermsOpen] = useState(false);
  // Same draft-resync-during-render pattern as the rows: the percentage
  // fields are text while they're being typed and follow the saved settings
  // whenever those change (a save landing, or a failed save rolling back).
  const stamp = `${settings.taxRate}\u0000${settings.depositPercent}`;
  const [pcts, setPcts] = useState(() => ({
    stamp,
    rate: String(settings.taxRate),
    dep: String(settings.depositPercent),
  }));
  if (pcts.stamp !== stamp) {
    setPcts({
      stamp,
      rate: String(settings.taxRate),
      dep: String(settings.depositPercent),
    });
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

  const pctField =
    "no-spinner w-16 rounded-lg border border-edge bg-card-hover px-2 py-1 text-right text-sm tabular-nums text-body outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-60";

  return (
    <section className="h-fit rounded-[14px] border border-edge bg-card p-5 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
      <h2 className="font-serif text-xl text-ink">Totals</h2>

      <dl className="mt-4 space-y-2.5 text-sm">
        <div className="flex items-baseline justify-between">
          <dt className="text-muted">Subtotal</dt>
          <dd className="font-mono tabular-nums text-body">
            {currency.format(totals.subtotal)}
          </dd>
        </div>

        <div
          className={`flex items-center justify-between gap-2 rounded ${
            washing === "tax_rate" ? "save-wash" : ""
          }`}
        >
          <dt className="flex items-center gap-1.5 text-muted">
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
              className={pctField}
            />
            <span className="text-faint">%</span>
          </dt>
          <dd className="font-mono tabular-nums text-body">
            {currency.format(totals.tax)}
          </dd>
        </div>
        {totals.taxableSubtotal !== totals.subtotal && (
          <p className="text-xs text-faint">
            On {currency.format(totals.taxableSubtotal)} of taxable lines.
          </p>
        )}

        <div className="flex items-baseline justify-between border-t border-rule pt-3">
          <dt className="font-semibold text-ink">Total</dt>
          <dd className="font-mono text-xl font-semibold tabular-nums text-ink">
            {currency.format(totals.total)}
          </dd>
        </div>

        <div
          className={`flex items-center justify-between gap-2 rounded pt-1 ${
            washing === "deposit_percent" ? "save-wash" : ""
          }`}
        >
          <dt className="flex items-center gap-1.5 text-muted">
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
              onBlur={() =>
                pct(dep, settings.depositPercent, setDep, onDeposit)
              }
              className={pctField}
            />
            <span className="text-faint">%</span>
          </dt>
          <dd className="font-mono tabular-nums text-body">
            {currency.format(totals.deposit)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between">
          <dt className="text-muted">Balance on completion</dt>
          <dd className="font-mono tabular-nums text-body">
            {currency.format(totals.balance)}
          </dd>
        </div>
      </dl>

      {/* How the proposal prints, next to the button that prints it. */}
      <div className="mt-5 border-t border-rule pt-4">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-faint">
          The client sees
        </p>
        <div
          role="group"
          aria-label="Client PDF detail"
          className="mt-2 flex gap-1 rounded-xl border border-rule bg-paper-deep p-1"
        >
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
              className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition ${
                detail === value
                  ? "bg-accent text-paper"
                  : "text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[0.68rem] leading-relaxed text-faint">
          {detail === "itemized"
            ? "Every line with its quantity and unit price."
            : "Category totals only — quantities and unit prices stay internal."}
        </p>
      </div>

      <a
        href={`/dashboard/projects/${projectId}/estimate/pdf`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 block w-full rounded-lg bg-accent px-4 py-2.5 text-center text-[13px] font-semibold text-paper transition hover:bg-accent-bright"
      >
        Generate Proposal
      </a>
      <a
        href={`/dashboard/projects/${projectId}/estimate/pdf?download=1`}
        className="mt-2 block text-center text-xs font-semibold text-muted transition hover:text-accent"
      >
        Download PDF
      </a>
      {/* Kept as a link rather than deleted with its card: overriding terms
          for one job was built deliberately, it is just not something that
          earns a panel of its own. */}
      <button
        type="button"
        disabled={readOnly}
        onClick={() => setTermsOpen((v) => !v)}
        className="mt-3 block w-full text-center text-xs font-semibold text-muted transition hover:text-accent disabled:opacity-50"
      >
        {termsOpen ? "Use company terms" : "Override terms for this estimate"}
      </button>
      {termsOpen && (
        <textarea
          defaultValue={terms ?? ""}
          onBlur={(e) => onTermsSave(e.target.value)}
          rows={5}
          placeholder="Terms for this estimate only…"
          className="mt-2 w-full rounded-lg border border-rule bg-card-hover px-3 py-2 text-sm text-body outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
      )}

      <p className="mt-3 text-center text-[0.68rem] leading-relaxed text-faint">
        Prints under your company&apos;s letterhead.
      </p>
    </section>
  );
}

