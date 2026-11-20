"use client";

// The Design tab's inventory bar — the headset's, on the desk. Seven slots
// hold what is being planted: a plant at a size, or a surface. A click on a
// slot arms it, and the plan (or the 3D view) plants it at each click; a
// click on the armed slot opens its sizes. Edit puts the bar down, so a
// click only ever picks. Add opens the catalog, and what's chosen there
// lands in a slot. The slots belong to this browser and carry from project
// to project, the way the headset keeps its bar.

import { useEffect, useRef, useState } from "react";
import { PLANTS, plantForKey, type CatalogPlant } from "@/lib/design-edit";
import { OFFERED_SURFACES, plantPrice, surfaceRate } from "@/lib/site-plan/design";
import type { PlanPlant, PlanSurface } from "@/lib/site-plan/plan";
import { SurfaceSwatch } from "./drawing";
import { CursorIcon, PlusIcon, RedoIcon, RulerIcon, SearchIcon, UndoIcon } from "./icons";
import { money, SURFACE_TOOLS, Thumb } from "./design-panels";
import type { Tool } from "./sheet";

export type Slot = { kind: "plant"; key: string; size: string } | { kind: "surface"; style: string } | null;

export const SLOT_COUNT = 7;

const CATEGORIES = ["Succulent", "Tree", "Shrub", "Groundcover", "Lighting", "Hardscape"];
const TOOL_NAME: Partial<Record<Tool, string>> = { rect: "Rectangle", area: "Shape", circle: "Circle" };
const STORE = "vv.design-bar.v1";

/** A slot the catalog still offers, or null. */
function valid(x: unknown): Slot {
  if (!x || typeof x !== "object") return null;
  const s = x as Record<string, unknown>;
  if (s.kind === "plant" && typeof s.key === "string" && typeof s.size === "string") {
    return plantForKey(s.key)?.sizes.some((z) => z.size === s.size) ? { kind: "plant", key: s.key, size: s.size } : null;
  }
  if (s.kind === "surface" && typeof s.style === "string") {
    return OFFERED_SURFACES.some((o) => o.style === s.style) ? { kind: "surface", style: s.style } : null;
  }
  return null;
}

/** The bar this browser last left, if it kept one. */
export function savedSlots(): Slot[] | null {
  try {
    const raw = localStorage.getItem(STORE);
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(list)) return null;
    const slots = Array.from({ length: SLOT_COUNT }, (_, i) => valid(list[i]));
    return slots.some(Boolean) ? slots : null;
  } catch {
    return null;
  }
}

export function keepSlots(slots: Slot[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(slots));
  } catch {
    // Private windows and blocked storage: the bar just starts fresh.
  }
}

/** A first bar for a browser that has none: what this design uses most. */
export function seedSlots(plants: PlanPlant[], surfaces: PlanSurface[]): Slot[] {
  const counts = new Map<string, { slot: Slot; n: number }>();
  for (const p of plants) {
    const k = `${p.key}|${p.size}`;
    const c = counts.get(k) ?? { slot: valid({ kind: "plant", key: p.key, size: p.size }), n: 0 };
    c.n++;
    counts.set(k, c);
  }
  const used = [...counts.values()].filter((c) => c.slot).sort((a, b) => b.n - a.n).map((c) => c.slot);
  for (const style of new Set(surfaces.map((s) => s.style))) used.push(valid({ kind: "surface", style }));
  const slots = used.filter(Boolean).slice(0, SLOT_COUNT);
  return [...slots, ...Array<Slot>(SLOT_COUNT - slots.length).fill(null)];
}

const same = (a: Slot, b: Slot) =>
  !!a &&
  !!b &&
  (a.kind === "plant" ? b.kind === "plant" && a.key === b.key && a.size === b.size : b.kind === "surface" && a.style === b.style);

export function InventoryBar({
  slots,
  onSlots,
  active,
  armed,
  onArm,
  onEdit,
  measuring,
  onMeasure,
  surfaceTool,
  onSurfaceTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  prices,
  editable,
}: {
  slots: Slot[];
  /** The bar changed; `active` follows a slot that was moved. */
  onSlots: (slots: Slot[], active?: number) => void;
  active: number;
  /** The active slot is planting (or drawing), not put down for Edit. */
  armed: boolean;
  onArm: (index: number, slot: Slot) => void;
  onEdit: () => void;
  /** Null: no measuring here (the 3D view). */
  measuring: boolean | null;
  onMeasure: () => void;
  surfaceTool: Tool;
  onSurfaceTool: (t: Tool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  prices: Record<string, number>;
  editable: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  // The slot whose sizes are open, and the slot the catalog fills.
  const [pop, setPop] = useState<number | null>(null);
  const [browsing, setBrowsing] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const open = pop != null || browsing != null;

  // A click anywhere else puts the popover and the catalog away.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setPop(null);
        setBrowsing(null);
      }
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const editOn = !armed && measuring !== true;
  const activeSlot = armed ? slots[active] : null;

  function put(index: number, slot: Slot) {
    const next = slots.slice();
    next[index] = slot;
    onSlots(next);
    if (slot) onArm(index, slot);
  }

  function click(i: number) {
    if (!editable) return;
    if (!slots[i]) {
      setPop(null);
      setBrowsing(i);
      return;
    }
    setBrowsing(null);
    if (i === active && armed) setPop((p) => (p === i ? null : i));
    else {
      setPop(null);
      onArm(i, slots[i]);
    }
  }

  function choose(slot: Slot) {
    const have = slots.findIndex((s) => same(s, slot));
    const target = browsing ?? active;
    setBrowsing(null);
    if (have >= 0) return onArm(have, slots[have]);
    const empty = slots.findIndex((s) => !s);
    put(slots[target] ? (empty >= 0 ? empty : target) : target, slot);
  }

  function drop(to: number) {
    const from = dragFrom;
    setDragFrom(null);
    if (from == null || from === to) return;
    const next = slots.slice();
    [next[from], next[to]] = [next[to], next[from]];
    onSlots(next, active === from ? to : active === to ? from : active);
  }

  return (
    <div
      ref={box}
      className="pointer-events-auto absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {browsing != null && (
        <Browser slots={slots} prices={prices} onChoose={choose} onClose={() => setBrowsing(null)} />
      )}
      {pop != null && slots[pop] && (
        <SlotPopover
          slot={slots[pop]}
          prices={prices}
          surfaceTool={surfaceTool}
          onSurfaceTool={onSurfaceTool}
          onChange={(s) => put(pop, s)}
          onRemove={() => {
            const next = slots.slice();
            next[pop] = null;
            onSlots(next);
            setPop(null);
            if (pop === active && armed) onEdit();
          }}
          onDone={() => setPop(null)}
        />
      )}
      {pop == null && browsing == null && activeSlot?.kind === "surface" && (
        <div className="mb-2 flex items-center gap-1 rounded-xl border border-rule-strong bg-card/95 p-1 pl-3 text-xs shadow-md backdrop-blur">
          <span className="mr-1 text-muted">
            Drawing <span className="font-semibold text-ink">{activeSlot.style}</span> as a
          </span>
          {SURFACE_TOOLS.map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => onSurfaceTool(x)}
              className={`rounded-md px-2 py-1 font-semibold transition ${
                surfaceTool === x ? "bg-accent text-white" : "text-muted hover:bg-card-hover hover:text-ink"
              }`}
            >
              {TOOL_NAME[x]}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-stretch gap-1.5 rounded-2xl border border-rule-strong bg-card/95 p-1.5 shadow-[0_14px_34px_-14px_rgba(28,42,33,0.45)] backdrop-blur">
        <div className="flex flex-col gap-1">
          <IconButton title="Undo (⌘Z)" disabled={!canUndo} onClick={onUndo}>
            <UndoIcon size={18} />
          </IconButton>
          <IconButton title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={onRedo}>
            <RedoIcon size={18} />
          </IconButton>
        </div>
        <BarButton on={editOn} title="Edit — clicks pick, never plant (V or Esc)" onClick={onEdit} disabled={!editable}>
          <CursorIcon />
          Edit
        </BarButton>
        <span className="mx-0.5 w-px self-stretch bg-rule" aria-hidden />
        {slots.map((slot, i) => (
          <SlotButton
            key={i}
            index={i}
            slot={slot}
            on={armed && i === active}
            open={pop === i || browsing === i}
            prices={prices}
            disabled={!editable}
            onClick={() => click(i)}
            onDoubleClick={() => slot && i === active && setPop(i)}
            onDragStart={() => setDragFrom(i)}
            onDrop={() => drop(i)}
          />
        ))}
        <span className="mx-0.5 w-px self-stretch bg-rule" aria-hidden />
        <BarButton
          on={browsing != null}
          title="Add from the catalog"
          disabled={!editable}
          onClick={() => {
            setPop(null);
            setBrowsing((b) => (b != null ? null : active));
          }}
        >
          <PlusIcon />
          {browsing != null ? "Close" : "Add"}
        </BarButton>
        {measuring != null && (
          <BarButton on={measuring} title="Measure (M)" onClick={onMeasure}>
            <RulerIcon />
            Measure
          </BarButton>
        )}
      </div>
    </div>
  );
}

function slotName(slot: NonNullable<Slot>): { name: string; sub: string; plant: CatalogPlant | null } {
  if (slot.kind === "surface") return { name: slot.style, sub: "Surface", plant: null };
  const plant = plantForKey(slot.key);
  return { name: plant?.name ?? slot.key, sub: slot.size, plant: plant ?? null };
}

function SlotButton({
  index,
  slot,
  on,
  open,
  prices,
  disabled,
  onClick,
  onDoubleClick,
  onDragStart,
  onDrop,
}: {
  index: number;
  slot: Slot;
  on: boolean;
  open: boolean;
  prices: Record<string, number>;
  disabled: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const [over, setOver] = useState(false);
  const info = slot ? slotName(slot) : null;
  const price = !slot ? 0 : slot.kind === "plant" ? plantPrice(slot, prices) : surfaceRate(slot.style, prices);
  return (
    <button
      type="button"
      disabled={disabled}
      draggable={!!slot && !disabled}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
      title={
        info
          ? `${info.name} · ${info.sub}${price > 0 ? ` · ${money(price)}${slot?.kind === "surface" ? "/ft²" : ""}` : ""} — key ${index + 1}${on ? ". Click again for sizes." : ""}`
          : `Empty — click to add (key ${index + 1})`
      }
      className={`relative flex w-[68px] flex-col items-center justify-center gap-1 rounded-xl border px-1 pb-1.5 pt-2 transition disabled:opacity-40 ${
        on
          ? "border-accent bg-accent/10 shadow-[inset_0_0_0_1px_var(--accent)]"
          : over
            ? "border-accent border-dashed bg-accent/5"
            : slot
              ? open
                ? "border-rule-strong bg-card-hover"
                : "border-transparent hover:border-rule-strong hover:bg-card-hover"
              : "border-dashed border-rule-strong text-faint hover:border-accent hover:text-accent"
      }`}
    >
      <span className="absolute left-1.5 top-1 font-mono text-[9px] text-faint">{index + 1}</span>
      {slot && info ? (
        <>
          {info.plant ? (
            <Thumb plant={info.plant} size={34} />
          ) : (
            <span className="flex h-[34px] w-[34px] items-center justify-center overflow-hidden rounded-full border border-rule">
              <SurfaceSwatch style={(slot as { style: string }).style} size={34} />
            </span>
          )}
          <span className={`w-full truncate text-center text-[10px] leading-tight ${on ? "font-semibold text-ink" : "text-body"}`}>
            {info.name}
          </span>
          <span className="-mt-1 text-[9px] leading-tight text-faint">{info.sub}</span>
        </>
      ) : (
        <span className="flex h-[34px] items-center text-xl leading-none">+</span>
      )}
    </button>
  );
}

function BarButton({
  on,
  title,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex w-[60px] flex-col items-center justify-center gap-1 rounded-xl border text-[11px] font-semibold transition disabled:opacity-40 ${
        on ? "border-accent/30 bg-accent/10 text-accent" : "border-transparent text-body hover:bg-card-hover hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function IconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-[34px] w-9 flex-1 items-center justify-center rounded-lg text-ink transition hover:bg-card-hover disabled:text-faint disabled:opacity-50 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/* ── A slot's sizes ──────────────────────────────────────────────── */

function SlotPopover({
  slot,
  prices,
  surfaceTool,
  onSurfaceTool,
  onChange,
  onRemove,
  onDone,
}: {
  slot: NonNullable<Slot>;
  prices: Record<string, number>;
  surfaceTool: Tool;
  onSurfaceTool: (t: Tool) => void;
  onChange: (s: Slot) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const info = slotName(slot);
  return (
    <div className="mb-2 w-[340px] rounded-xl border border-rule-strong bg-card p-3 shadow-lg">
      <div className="flex items-center gap-3">
        {info.plant ? (
          <Thumb plant={info.plant} size={44} />
        ) : (
          <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-rule">
            <SurfaceSwatch style={(slot as { style: string }).style} size={44} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{info.name}</p>
          <p className="truncate text-xs italic text-muted">{info.plant?.botanicalName ?? "Surface"}</p>
        </div>
      </div>
      {slot.kind === "plant" && info.plant ? (
        <>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-faint">Size</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {info.plant.sizes.map((s) => {
              const price = plantPrice({ key: slot.key, size: s.size }, prices);
              return (
                <button
                  key={s.size}
                  type="button"
                  onClick={() => onChange({ kind: "plant", key: slot.key, size: s.size })}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                    s.size === slot.size ? "border-accent bg-accent text-white" : "border-rule-strong text-body hover:border-accent"
                  }`}
                >
                  {s.size}
                  <span className="ml-1.5 font-normal opacity-80">{price > 0 ? money(price) : "—"}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 text-xs text-muted">
            {surfaceRate((slot as { style: string }).style, prices) > 0
              ? `${money(surfaceRate((slot as { style: string }).style, prices))} per ft²`
              : "Not priced on your grid"}
          </p>
          <div className="mt-2 flex gap-1.5">
            {SURFACE_TOOLS.map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => onSurfaceTool(x)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                  surfaceTool === x ? "border-accent bg-accent text-white" : "border-rule-strong text-body hover:border-accent"
                }`}
              >
                {TOOL_NAME[x]}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="mt-3 flex items-center justify-between border-t border-rule pt-2.5 text-xs font-semibold">
        <button type="button" onClick={onRemove} className="text-muted transition hover:text-clay">
          Take off the bar
        </button>
        <button type="button" onClick={onDone} className="text-accent transition hover:text-accent-bright">
          Done
        </button>
      </div>
    </div>
  );
}

/* ── The catalog ─────────────────────────────────────────────────── */

function Browser({
  slots,
  prices,
  onChoose,
  onClose,
}: {
  slots: Slot[];
  prices: Record<string, number>;
  onChoose: (s: Slot) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const plants = PLANTS.filter(
    (p) =>
      (!category || p.category === category) &&
      (!q || p.name.toLowerCase().includes(q) || (p.botanicalName ?? "").toLowerCase().includes(q))
  );
  const surfaces = OFFERED_SURFACES.filter(
    ({ style }) => (!category || category === "Hardscape") && (!q || style.toLowerCase().includes(q))
  );
  // The size a plant goes on the bar in: the one already there, if it is.
  const sizeOf = (p: CatalogPlant) =>
    (slots.find((s) => s?.kind === "plant" && s.key === p.key) as { size: string } | undefined)?.size ?? p.sizes[0]?.size;

  return (
    <div
      className="mb-2 flex max-h-[min(62vh,560px)] w-[min(780px,calc(100vw-360px))] min-w-[520px] flex-col overflow-hidden rounded-2xl border border-rule-strong bg-card shadow-xl"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-2 border-b border-rule p-3">
        <label className="flex flex-1 items-center gap-2 rounded-lg border border-rule-strong bg-card-hover px-2.5 py-1.5 text-muted focus-within:border-accent">
          <SearchIcon size={15} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the catalog"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
          />
        </label>
        <button type="button" onClick={onClose} className="px-2 text-sm font-semibold text-muted hover:text-ink" title="Close (Esc)">
          ✕
        </button>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-rule px-3 py-2">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory((x) => (x === c ? null : c))}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
              category === c ? "border-ink bg-ink text-paper" : "border-rule-strong text-muted hover:text-ink"
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {plants.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
            {plants.map((p) => {
              const size = sizeOf(p);
              const onBar = slots.some((s) => s?.kind === "plant" && s.key === p.key);
              const price = size ? plantPrice({ key: p.key, size }, prices) : 0;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => size && onChoose({ kind: "plant", key: p.key, size })}
                  className={`flex items-center gap-2.5 rounded-xl border p-2 text-left transition hover:border-accent hover:bg-accent/5 ${
                    onBar ? "border-accent/50" : "border-rule"
                  }`}
                >
                  <Thumb plant={p} size={42} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[13px] leading-tight text-ink">{p.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-faint">
                      {size}
                      {price > 0 && ` · ${money(price)}`}
                      {onBar && " · on bar"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {surfaces.length > 0 && (
          <>
            <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-faint">Surfaces</p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
              {surfaces.map(({ style }) => {
                const rate = surfaceRate(style, prices);
                const onBar = slots.some((s) => s?.kind === "surface" && s.style === style);
                return (
                  <button
                    key={style}
                    type="button"
                    onClick={() => onChoose({ kind: "surface", style })}
                    className={`flex items-center gap-2.5 rounded-xl border p-2 text-left transition hover:border-accent hover:bg-accent/5 ${
                      onBar ? "border-accent/50" : "border-rule"
                    }`}
                  >
                    <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-rule">
                      <SurfaceSwatch style={style} size={42} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[13px] leading-tight text-ink">{style}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-faint">
                        {rate > 0 ? `${money(rate)}/ft²` : "per ft²"}
                        {onBar && " · on bar"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {plants.length === 0 && surfaces.length === 0 && <p className="text-sm text-muted">Nothing matches “{query}”.</p>}
      </div>
    </div>
  );
}
