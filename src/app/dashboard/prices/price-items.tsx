"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { PriceItem } from "./page";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function PriceItems({ items }: { items: PriceItem[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"plant" | "labor">("plant");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = Number(price);
    if (!name.trim() || !price || Number.isNaN(parsed) || parsed < 0) {
      setError("Enter a name and a valid price.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const { error: insertError } = await supabase.from("price_items").insert({
        name: name.trim(),
        category,
        price: parsed,
        unit: category === "labor" ? "hour" : "each",
      });
      if (insertError) throw new Error(insertError.message);

      setName("");
      setPrice("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save price.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from("price_items")
        .delete()
        .eq("id", id);
      if (deleteError) throw new Error(deleteError.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete price.");
    } finally {
      setBusy(false);
    }
  }

  const plants = items.filter((i) => i.category === "plant");
  const labor = items.filter((i) => i.category === "labor");

  return (
    <div>
      <form
        onSubmit={handleAdd}
        className="flex flex-wrap items-end gap-3 rounded-[10px] border border-rule bg-paper/60 p-4"
      >
        <div className="min-w-44 flex-1">
          <label
            htmlFor="price-name"
            className="block text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted"
          >
            Name
          </label>
          <input
            id="price-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              category === "labor" ? "e.g., Crew labor" : "e.g., Golden Barrel 5 gal"
            }
            className="mt-1.5 w-full rounded-lg border border-edge bg-card-hover px-3 py-2 text-sm text-body outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
        </div>
        <div>
          <label
            htmlFor="price-category"
            className="block text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted"
          >
            Type
          </label>
          <select
            id="price-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as "plant" | "labor")}
            className="mt-1.5 rounded-lg border border-edge bg-card-hover px-3 py-2 text-sm text-body outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
          >
            <option value="plant">Plant (per item)</option>
            <option value="labor">Labor (per hour)</option>
          </select>
        </div>
        <div className="w-32">
          <label
            htmlFor="price-amount"
            className="block text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted"
          >
            Price ($)
          </label>
          <input
            id="price-amount"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            className="mt-1.5 w-full rounded-lg border border-edge bg-card-hover px-3 py-2 text-sm text-body outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-paper shadow-[0_10px_22px_-10px_rgba(35,74,53,0.45)] transition hover:-translate-y-0.5 hover:bg-accent-bright disabled:transform-none disabled:opacity-40"
        >
          Add price
        </button>
      </form>

      {error && <p className="mt-2 text-sm text-clay">{error}</p>}

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No manual prices yet.</p>
      ) : (
        <div className="mt-5 grid gap-6 md:grid-cols-2">
          {(
            [
              ["Plants", plants, "each"],
              ["Labor", labor, "hr"],
            ] as const
          ).map(([title, group, unitLabel]) => (
            <div key={title}>
              <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
                {title}
              </h3>
              {group.length === 0 ? (
                <p className="mt-2 text-sm text-muted">None yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-rule">
                  {group.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <span className="min-w-0 truncate text-sm text-body">
                        {item.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="font-mono text-sm font-semibold text-accent-dim">
                          {currency.format(item.price)}
                          <span className="font-sans text-xs font-normal text-faint">
                            /{unitLabel}
                          </span>
                        </span>
                        <button
                          onClick={() => handleDelete(item.id)}
                          disabled={busy}
                          aria-label={`Delete ${item.name}`}
                          className="text-clay transition hover:opacity-75 disabled:opacity-40"
                        >
                          <svg
                            className="h-4 w-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          >
                            <path d="M4 7h16m-10-3h4M6.5 7l.8 13a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-13M10 11v6m4-6v6" />
                          </svg>
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
