"use client";

import { useEffect, useMemo, useState } from "react";
import type { CatalogPlant } from "@/lib/price-stats";

// Category filter chips, in display order. Labels group the botanical
// categories the way a designer thinks about the palette.
const CATEGORY_LABELS: [string, string][] = [
  ["Tree", "Trees"],
  ["Shrub", "Shrubs"],
  ["Succulent", "Cacti & Succulents"],
  ["Groundcover", "Groundcover"],
  ["Flower", "Flowers"],
  ["Grass", "Grasses"],
  ["Hardscape", "Boulders & Pools"],
  ["Lighting", "Lighting"],
];

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const feet = (n: number) =>
  Number.isInteger(n) ? `${n}′` : `${n.toFixed(1)}′`;

export function PlantLibrary({
  plants,
  sizeOrder,
  priceOverrides,
  usage,
}: {
  plants: CatalogPlant[];
  sizeOrder: string[];
  priceOverrides: Record<string, number>;
  usage: Record<string, number>;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const priceFor = (plant: CatalogPlant, size: string) =>
    priceOverrides[`${plant.key}|${size}`] ??
    plant.sizes.find((s) => s.size === size)?.price;

  const chips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of plants) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    return CATEGORY_LABELS.filter(([raw]) => counts.has(raw)).map(
      ([raw, label]) => ({ raw, label, count: counts.get(raw)! })
    );
  }, [plants]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return plants
      .filter((p) => !category || p.category === category)
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.botanicalName ?? "").toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [plants, category, query]);

  const open = openKey ? plants.find((p) => p.key === openKey) ?? null : null;

  const categoryLabel =
    CATEGORY_LABELS.find(([raw]) => raw === category)?.[1] ?? category;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenKey(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-12 lg:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-clay">
            Plant Library
          </p>
          <h1 className="mt-2 font-serif text-4xl text-ink">
            The palette
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Every asset you can place in a design — {plants.length} and
            counting. These renders are the actual 3D models your clients
            see in the headset.
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search common or botanical name…"
          className="w-full max-w-xs rounded-[10px] border border-edge bg-card px-3.5 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
        />
      </header>

      <div className="mt-6 flex flex-wrap gap-2">
        {[{ raw: null as string | null, label: "All", count: plants.length }, ...chips].map(
          (chip) => (
            <button
              key={chip.label}
              onClick={() => setCategory(chip.raw)}
              className={`rounded-full border px-3.5 py-1.5 text-[0.8rem] transition-colors ${
                category === chip.raw
                  ? "border-accent bg-accent text-card"
                  : "border-edge bg-card text-ink hover:bg-card-hover"
              }`}
            >
              {chip.label}
              <span
                className={`ml-1.5 text-[0.7rem] ${
                  category === chip.raw ? "text-card/70" : "text-muted"
                }`}
              >
                {chip.count}
              </span>
            </button>
          )
        )}
      </div>

      {shown.length === 0 ? (
        <p className="mt-12 text-sm text-muted">
          Nothing matches &ldquo;{query}&rdquo;
          {category ? ` in ${categoryLabel}` : ""}. A plant we should add?
          That gap is exactly what custom placeholder plants will cover.
        </p>
      ) : (
        <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((p) => {
            const prices = p.sizes
              .map((s) => priceFor(p, s.size))
              .filter((n): n is number => n != null);
            const min = prices.length ? Math.min(...prices) : null;
            return (
              <li key={p.key} className="h-full">
                <button
                  onClick={() => setOpenKey(p.key)}
                  className="group flex h-full w-full flex-col rounded-[14px] border border-edge bg-card text-left shadow-[0_14px_30px_-24px_rgba(28,42,33,0.4)] transition-colors hover:bg-card-hover"
                >
                  <div className="flex aspect-square items-center justify-center rounded-t-[14px] bg-[radial-gradient(closest-side,rgba(46,93,67,0.10),transparent)] p-4">
                    {p.thumbnail ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={`/plants/${p.thumbnail}.webp`}
                        alt={p.name}
                        className="max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-[1.04]"
                        loading="lazy"
                      />
                    ) : (
                      <span className="text-4xl text-accent/40">✦</span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col px-4 pb-4 pt-1">
                    <h2 className="font-serif text-lg leading-snug text-ink">
                      {p.name}
                    </h2>
                    {p.botanicalName && (
                      <p className="mt-0.5 truncate text-xs italic text-muted">
                        {p.botanicalName}
                      </p>
                    )}
                    <p className="mt-auto flex items-baseline justify-between pt-2 text-xs text-muted">
                      <span>
                        {p.matureHeightFt != null && p.matureWidthFt != null
                          ? `${feet(p.matureHeightFt)} × ${feet(p.matureWidthFt)} mature`
                          : p.category}
                      </span>
                      {min != null && (
                        <span className="font-medium text-accent">
                          from {money(min)}
                        </span>
                      )}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4 backdrop-blur-[2px]"
          onClick={() => setOpenKey(null)}
        >
          <div
            className="grid max-h-[88vh] w-full max-w-3xl grid-cols-1 overflow-y-auto rounded-[14px] border border-edge bg-card shadow-[0_30px_80px_-30px_rgba(28,42,33,0.6)] md:grid-cols-[1fr_1.25fr]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col bg-[radial-gradient(closest-side,rgba(46,93,67,0.12),transparent)] p-6">
              {open.thumbnail && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/plants/${open.thumbnail}.webp`}
                  alt={open.name}
                  className="m-auto max-h-72 object-contain"
                />
              )}
              {(usage[open.key] ?? 0) > 0 && (
                <p className="mt-4 text-center text-xs text-muted">
                  Placed {usage[open.key]}× across your projects
                </p>
              )}
            </div>

            <div className="p-6 md:pl-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-clay">
                    {open.category}
                  </p>
                  <h2 className="mt-1 font-serif text-2xl text-ink">
                    {open.name}
                  </h2>
                  {open.botanicalName && (
                    <p className="text-sm italic text-muted">
                      {open.botanicalName}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setOpenKey(null)}
                  aria-label="Close"
                  className="rounded-full border border-edge px-2.5 py-1 text-sm text-muted hover:bg-card-hover"
                >
                  ✕
                </button>
              </div>

              {open.description && (
                <p className="mt-4 text-[0.84rem] leading-relaxed text-ink/85">
                  {open.description}
                </p>
              )}

              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[0.8rem]">
                {(
                  [
                    ["Mature size",
                      open.matureHeightFt != null && open.matureWidthFt != null
                        ? `${feet(open.matureHeightFt)} tall × ${feet(open.matureWidthFt)} wide`
                        : null],
                    ["Sun", open.sun],
                    ["Water", open.water],
                    ["Hardy to",
                      open.coldToleranceFahrenheit != null
                        ? `${open.coldToleranceFahrenheit}°F`
                        : null],
                    ["Bloom", open.bloomPeriod],
                    ["Growth", open.growthRate],
                    ["Lifespan", open.lifespan],
                    ["Native to", open.origin],
                  ] as [string, string | null][]
                )
                  .filter(([, v]) => v)
                  .map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted">
                        {label}
                      </dt>
                      <dd className="mt-0.5 text-ink">{value}</dd>
                    </div>
                  ))}
              </dl>

              <table className="mt-5 w-full text-[0.8rem]">
                <thead>
                  <tr className="text-left text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted">
                    <th className="pb-1.5 font-semibold">Size</th>
                    <th className="pb-1.5 text-right font-semibold">Installed price</th>
                  </tr>
                </thead>
                <tbody>
                  {sizeOrder
                    .filter((size) => open.sizes.some((s) => s.size === size))
                    .map((size) => {
                      const override = priceOverrides[`${open.key}|${size}`];
                      const price = priceFor(open, size);
                      return (
                        <tr key={size} className="border-t border-edge">
                          <td className="py-1.5 text-ink">{size}</td>
                          <td className="py-1.5 text-right text-ink">
                            {price != null ? money(price) : "—"}
                            {override != null && (
                              <span className="ml-1.5 text-[0.68rem] text-accent">
                                your price
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
