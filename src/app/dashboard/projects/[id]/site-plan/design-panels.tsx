"use client";

// The Design tab's panels: the row of buttons by the picked plant, and the
// schedule with its running total. The inventory bar picks what gets placed
// and the sheet places it; these say what it is and what it costs.

import { closestSize, PLANTS, plantForKey, SIZE_ORDER, thumbnailURL, type CatalogPlant } from "@/lib/design-edit";
import {
  plantPrice,
  surfacePrice,
  surfaceRate,
  surfaceSqFtOf,
  designTotal,
} from "@/lib/site-plan/design";
import type { PlanPlant, PlanSurface } from "@/lib/site-plan/plan";
import { useState } from "react";
import { SurfaceSwatch } from "./drawing";
import { BackIcon, CheckIcon, CopyIcon, SizeIcon, SwapIcon, TrashIcon, TurnIcon } from "./icons";
import type { Tool } from "./sheet";

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 });

/** What a surface is drawn with, the usual way first. */
export const SURFACE_TOOLS: Tool[] = ["rect", "area", "circle"];

export function Thumb({ plant, size = 36 }: { plant: CatalogPlant; size?: number }) {
  const src = thumbnailURL(plant);
  if (!src) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-full border border-accent/40 font-mono text-[10px] text-accent"
        style={{ width: size, height: size }}
      >
        {plant.name.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    // A plain <img>: local files under public/, drawn small.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="shrink-0 rounded-full border border-rule bg-card-hover object-cover"
      style={{ width: size, height: size }}
    />
  );
}

/* ── By the plant: what can be done to it ────────────────────────── */

type Pane = "main" | "size" | "swap";

/**
 * The picked plant's buttons, floating beside it on the plan or in 3D — the
 * headset's plant panel: change its size (with each size's price), swap it
 * for another of its kind, turn it, duplicate it, delete it. A group of
 * plants gets the same row; size and swap only when they're all one plant.
 * Re-key it on the selection, so it opens on its main row each time.
 */
export function PlantActions({
  plants,
  prices,
  onChange,
  onTurn,
  onDuplicate,
  onDelete,
}: {
  plants: PlanPlant[];
  prices: Record<string, number>;
  /** Makes every picked plant this catalog plant at this size. */
  onChange: (next: Pick<PlanPlant, "key" | "size">) => void;
  onTurn: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [pane, setPane] = useState<Pane>("main");
  // What the size row started from, so its back arrow can put it back.
  const [before, setBefore] = useState<string | null>(null);
  const first = plants[0];
  const plant = first ? plantForKey(first.key) : null;
  if (!first || !plant) return null;
  const one = plants.length === 1;
  const same = plants.every((p) => p.key === first.key);
  const sameSize = same && plants.every((p) => p.size === first.size);
  const others = same ? PLANTS.filter((x) => x.category === plant.category && x.key !== plant.key) : [];
  const total = plants.reduce((t, p) => t + plantPrice(p, prices), 0);

  const title = one ? plant.name : same ? `${plant.name} ×${plants.length}` : `${plants.length} plants`;
  const facts = [
    sameSize ? first.size : null,
    one && plant.matureWidthFt != null ? `${plant.matureWidthFt} ft wide` : null,
    total > 0 ? money(total) : one ? "Not priced" : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex max-w-[280px] items-center gap-2 rounded-full bg-card/95 py-1 pl-1 pr-3 shadow-md ring-1 ring-rule-strong">
        {same ? <Thumb plant={plant} size={26} /> : <span className="h-[26px] w-1" />}
        <span className="min-w-0 truncate text-xs font-semibold text-ink">{title}</span>
        {facts.length > 0 && <span className="shrink-0 text-[11px] text-muted">{facts.join(" · ")}</span>}
      </div>

      <div className="flex items-start gap-1 rounded-2xl bg-card/95 p-1.5 shadow-lg ring-1 ring-rule-strong">
        {pane === "main" && (
          <>
            {same && plant.sizes.length > 1 && (
              <RoundButton
                label="Size"
                title="Change its size"
                onClick={() => {
                  setBefore(sameSize ? first.size : null);
                  setPane("size");
                }}
              >
                <SizeIcon />
              </RoundButton>
            )}
            {others.length > 0 && (
              <RoundButton label="Swap" title={`Swap for another ${plant.category.toLowerCase()}`} onClick={() => setPane("swap")}>
                <SwapIcon />
              </RoundButton>
            )}
            <RoundButton label="Turn" title="Turn 45° (R)" onClick={onTurn}>
              <TurnIcon />
            </RoundButton>
            <RoundButton label="Copy" title="Duplicate (⌘D)" onClick={onDuplicate}>
              <CopyIcon />
            </RoundButton>
            <RoundButton label="Delete" title="Delete (⌫)" onClick={onDelete} danger>
              <TrashIcon />
            </RoundButton>
          </>
        )}

        {pane === "size" && (
          <>
            <RoundButton
              label="Back"
              title="Back, as it was"
              onClick={() => {
                if (before && !(sameSize && first.size === before)) onChange({ key: first.key, size: before });
                setPane("main");
              }}
            >
              <BackIcon />
            </RoundButton>
            {plant.sizes.map((s) => {
              const on = sameSize && s.size === first.size;
              const price = plantPrice({ key: first.key, size: s.size }, prices);
              return (
                <button
                  key={s.size}
                  type="button"
                  onClick={() => onChange({ key: first.key, size: s.size })}
                  className={`flex h-[52px] min-w-[52px] flex-col items-center justify-center rounded-xl px-2 transition ${
                    on ? "bg-accent text-white" : "text-ink hover:bg-card-hover"
                  }`}
                >
                  <span className="text-xs font-semibold">{s.size}</span>
                  <span className={`text-[10px] ${on ? "text-white/80" : "text-muted"}`}>{price > 0 ? money(price) : "—"}</span>
                </button>
              );
            })}
            <RoundButton label="Done" title="Keep this size" onClick={() => setPane("main")} strong>
              <CheckIcon />
            </RoundButton>
          </>
        )}

        {pane === "swap" && (
          <>
            <RoundButton label="Back" title="Back" onClick={() => setPane("main")}>
              <BackIcon />
            </RoundButton>
            <div className="flex max-w-[360px] gap-1 overflow-x-auto">
              {others.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  title={x.name}
                  onClick={() => {
                    const size = closestSize(x, first.size);
                    if (size) onChange({ key: x.key, size: size.size });
                    setPane("main");
                  }}
                  className="flex w-[64px] shrink-0 flex-col items-center gap-0.5 rounded-xl px-1 py-1 transition hover:bg-card-hover"
                >
                  <Thumb plant={x} size={30} />
                  <span className="w-full truncate text-center text-[10px] font-semibold text-body">{x.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RoundButton({
  label,
  title,
  onClick,
  danger = false,
  strong = false,
  children,
}: {
  label: string;
  title: string;
  onClick: () => void;
  danger?: boolean;
  strong?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`group flex w-[52px] flex-col items-center gap-0.5 rounded-xl py-1 transition ${
        danger ? "text-body hover:text-clay" : "text-body hover:text-ink"
      }`}
    >
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
          strong ? "bg-accent text-white group-hover:bg-accent-bright" : "bg-card-hover group-hover:bg-rule"
        }`}
      >
        {children}
      </span>
      <span className="text-[10px] font-semibold">{label}</span>
    </button>
  );
}

/* ── Right: the schedule ─────────────────────────────────────────── */

type Row = { key: string; size: string; plant: CatalogPlant; ids: string[] };

/** The plants grouped by catalog plant and size, the way the blueprint's
 *  schedule groups them. */
function scheduleOf(plants: PlanPlant[]): Row[] {
  const rows = new Map<string, Row>();
  for (const p of plants) {
    const plant = plantForKey(p.key);
    if (!plant) continue;
    const k = `${p.key}|${p.size}`;
    const row = rows.get(k) ?? { key: p.key, size: p.size, plant, ids: [] };
    row.ids.push(p.id);
    rows.set(k, row);
  }
  return [...rows.values()].sort(
    (a, b) => a.plant.name.localeCompare(b.plant.name) || SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size)
  );
}

export function Schedule({
  plants,
  surfaces,
  others,
  prices,
  selected,
  onSelect,
}: {
  plants: PlanPlant[];
  surfaces: PlanSurface[];
  /** Items placed on the headset the catalog can't name. */
  others: number;
  prices: Record<string, number>;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const rows = scheduleOf(plants);
  const total = designTotal(plants, surfaces, prices);
  const unpriced =
    rows.some((r) => plantPrice(r, prices) === 0) || surfaces.some((s) => surfaceRate(s.style, prices) === 0);

  return (
    <div className="pb-3">
      <div className="px-4 pb-2 pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">In this design</p>
      </div>
      {rows.length === 0 && surfaces.length === 0 ? (
        <p className="px-4 text-sm text-muted">
          Nothing placed yet. Pick a plant on the left and click the plan to place it.
        </p>
      ) : (
        <ul>
          {rows.map((r) => {
            const each = plantPrice(r, prices);
            const on = selected != null && r.ids.includes(selected);
            return (
              <li key={`${r.key}|${r.size}`}>
                <button
                  type="button"
                  // Each click moves on to the next plant of the row.
                  onClick={() => onSelect(r.ids[(r.ids.indexOf(selected ?? "") + 1) % r.ids.length])}
                  className={`flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-sm transition ${
                    on ? "bg-accent/10 font-semibold text-ink" : "text-body hover:bg-card-hover"
                  }`}
                >
                  <Thumb plant={r.plant} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.plant.name}</span>
                    <span className="block text-[11px] font-normal text-muted">{r.size}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                    ×{r.ids.length}
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {each > 0 ? money(each * r.ids.length) : "—"}
                  </span>
                </button>
              </li>
            );
          })}
          {surfaces.map((s) => {
            const price = surfacePrice(s, prices);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  className={`flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-sm transition ${
                    selected === s.id ? "bg-accent/10 font-semibold text-ink" : "text-body hover:bg-card-hover"
                  }`}
                >
                  <SurfaceSwatch style={s.style} size={20} />
                  <span className="min-w-0 flex-1 truncate">{s.style}</span>
                  <span className="shrink-0 text-xs text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {Math.round(surfaceSqFtOf(s)).toLocaleString()} ft²
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {price > 0 ? money(Math.round(price)) : "—"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {others > 0 && (
        <p className="px-4 pt-2 text-xs text-muted">
          {others === 1 ? "1 item" : `${others} items`} placed on the headset aren&apos;t in the catalog — shown, not
          counted.
        </p>
      )}
      <div className="mx-4 mt-3 flex items-baseline justify-between border-t border-rule pt-3">
        <span className="text-sm font-semibold">Materials</span>
        <span className="font-serif text-xl" style={{ fontVariantNumeric: "tabular-nums" }}>
          {money(total)}
        </span>
      </div>
      {unpriced && (
        <p className="px-4 pt-1 text-[11px] leading-relaxed text-faint">
          A dash is a price the firm hasn&apos;t set yet — it counts as $0. Set prices on the Plant Prices and Hardscape
          Prices pages.
        </p>
      )}
    </div>
  );
}
