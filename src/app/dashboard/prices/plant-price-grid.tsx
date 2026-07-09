"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CatalogPlant } from "@/lib/price-stats";

// App-order categories (PlantItem.Category) with picker labels.
const CATEGORY_LABELS: Record<string, string> = {
  Tree: "Trees",
  Shrub: "Shrubs",
  Flower: "Flowers",
  Grass: "Grasses",
  Succulent: "Succulents",
  Groundcover: "Groundcover",
  Hardscape: "Hardscape",
};
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

type Props = {
  plants: CatalogPlant[];
  sizes: string[];
  initial: Record<string, number>; // "plant_key|size" -> price
};

const cellKey = (plantKey: string, size: string) => `${plantKey}|${size}`;

const format = (entries: Record<string, number>) =>
  Object.fromEntries(
    Object.entries(entries).map(([k, v]) => [k, v.toFixed(2)])
  );

// Every catalog plant, one row each, editable price per available size.
// Cells save on blur; a blank cell means "use the built-in default".
export function PlantPriceGrid({ plants, sizes, initial }: Props) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    format(initial)
  );
  const [saved, setSaved] = useState<Record<string, string>>(() =>
    format(initial)
  );
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const categories = useMemo(
    () =>
      CATEGORY_ORDER.filter((cat) => plants.some((p) => p.category === cat)),
    [plants]
  );

  const visiblePlants = useMemo(() => {
    const q = query.trim().toLowerCase();
    return plants
      .filter((p) => filter === "All" || p.category === filter)
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.botanicalName?.toLowerCase().includes(q) ?? false)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [plants, filter, query]);

  async function commit(plantKey: string, size: string) {
    const key = cellKey(plantKey, size);
    const value = (draft[key] ?? "").trim();
    if (value === (saved[key] ?? "")) return;
    setError(null);

    const supabase = createClient();
    try {
      if (value === "") {
        const { error: deleteError } = await supabase
          .from("plant_prices")
          .delete()
          .eq("plant_key", plantKey)
          .eq("size", size);
        if (deleteError) throw new Error(deleteError.message);
        setSaved((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setDraft((prev) => ({ ...prev, [key]: "" }));
      } else {
        const price = Number(value);
        if (Number.isNaN(price) || price < 0) {
          setError(`"${value}" isn't a valid price.`);
          return;
        }
        const { error: upsertError } = await supabase
          .from("plant_prices")
          .upsert(
            { plant_key: plantKey, size, price },
            { onConflict: "user_id,plant_key,size" }
          );
        if (upsertError) throw new Error(upsertError.message);
        setSaved((prev) => ({ ...prev, [key]: price.toFixed(2) }));
        setDraft((prev) => ({ ...prev, [key]: price.toFixed(2) }));
      }
      setFlashKey(key);
      setTimeout(() => setFlashKey((k) => (k === key ? null : k)), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save price.");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter by plant type"
          className="rounded-lg border border-edge bg-card-hover px-3 py-2 text-sm text-body outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
        >
          <option value="All">All types</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {CATEGORY_LABELS[cat]}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search plants"
          aria-label="Search plants"
          className="w-52 rounded-lg border border-edge bg-card-hover px-3 py-2 text-sm text-body outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
      </div>

      {error && <p className="mt-2 text-sm text-clay">{error}</p>}

      <div className="mt-4 overflow-x-auto lg:overflow-x-visible">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-rule">
              <th className="py-2 pr-3 text-left text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted">
                Plant
              </th>
              {sizes.map((size) => (
                <th
                  key={size}
                  className="px-1.5 py-2 text-right text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted"
                >
                  {size}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visiblePlants.map((plant) => (
              <tr key={plant.key} className="border-b border-rule/60">
                <td className="py-2 pr-3">
                  <span className="text-body">{plant.name}</span>
                  {plant.botanicalName && (
                    <span className="ml-2 hidden text-xs italic text-faint xl:inline">
                      {plant.botanicalName}
                    </span>
                  )}
                </td>
                {sizes.map((size) => {
                  const available = plant.sizes.some((s) => s.size === size);
                  if (!available) {
                    return <td key={size} className="px-1.5 py-2" />;
                  }
                  const key = cellKey(plant.key, size);
                  const overridden = (saved[key] ?? "") !== "";
                  return (
                    <td key={size} className="relative px-1.5 py-2 text-right">
                      <span className="relative inline-block">
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-faint">
                          $
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={draft[key] ?? ""}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              [key]: e.target.value,
                            }))
                          }
                          onBlur={() => commit(plant.key, size)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                          aria-label={`${plant.name} ${size} price`}
                          className={`no-spinner w-24 rounded-md border bg-card-hover py-1.5 pl-5 pr-2 text-right text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft ${
                            flashKey === key ? "save-wash " : ""
                          }${
                            overridden
                              ? "border-accent/50 font-semibold text-accent-dim"
                              : "border-edge text-body"
                          }`}
                        />
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visiblePlants.length === 0 && (
        <p className="mt-4 text-sm text-muted">
          No plants match{query.trim() ? ` “${query}”` : " this filter"}.
        </p>
      )}
    </div>
  );
}
