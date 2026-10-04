"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { priceCell } from "@/lib/price-book";
import {
  STYLES,
  SURFACE_LABOR_SIZE,
  SURFACE_PRICE_SIZE,
  surfacePriceKey,
} from "@/lib/surfaces";

type Props = {
  /** "plant_key|size" → price — the same plant_prices rows as the grid. */
  initial: Record<string, number>;
};

const COLUMNS = [
  { size: SURFACE_PRICE_SIZE, label: "Material / ft²" },
  { size: SURFACE_LABOR_SIZE, label: "Labor / ft²" },
];

// Traced surfaces — pavers, turf, decomposed granite — priced per square
// foot. Stored in plant_prices under "surface:<style>" so the headset gets
// them from the same /api/prices read as every other price, and saved on
// blur exactly like the grid above. A blank is $0 on the estimate and in the
// headset; there is no built-in number behind it.
export function SurfacePrices({ initial }: Props) {
  const seed = () =>
    Object.fromEntries(
      STYLES.flatMap((style) =>
        COLUMNS.map(({ size }) => {
          const key = priceCell(surfacePriceKey(style), size);
          return [key, initial[key]?.toFixed(2) ?? ""];
        })
      )
    );

  const [draft, setDraft] = useState<Record<string, string>>(seed);
  const [saved, setSaved] = useState<Record<string, string>>(seed);
  const [washKey, setWashKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function commit(plantKey: string, size: string) {
    const key = priceCell(plantKey, size);
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
        setSaved((prev) => ({ ...prev, [key]: "" }));
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
      setWashKey(key);
      setTimeout(() => setWashKey((k) => (k === key ? null : k)), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save price.");
    }
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-left text-sm">
          <thead>
            <tr className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-on-clay">
              <th className="border border-ink/20 bg-clay px-2.5 py-2">Surface</th>
              {COLUMNS.map(({ size, label }) => (
                <th key={size} className="w-36 border border-ink/20 bg-clay px-2.5 py-2 text-right">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STYLES.map((style) => {
              const plantKey = surfacePriceKey(style);
              return (
                <tr key={style.case}>
                  <td className="border border-ink/20 px-2.5 py-2 text-body">{style.style}</td>
                  {COLUMNS.map(({ size, label }) => {
                    const key = priceCell(plantKey, size);
                    const isSet = (saved[key] ?? "") !== "";
                    return (
                      <td key={size} className="border border-ink/20 p-0 text-right">
                        <span className="relative block">
                          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-faint">
                            $
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={draft[key] ?? ""}
                            onChange={(e) =>
                              setDraft((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                            onBlur={() => commit(plantKey, size)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                            }}
                            aria-label={`${style.style} ${label}`}
                            className={`no-spinner block h-9 w-full bg-transparent pl-6 pr-2.5 text-right text-sm tabular-nums outline-none focus:bg-card-hover focus:outline-2 focus:-outline-offset-2 focus:outline-accent ${
                              washKey === key ? "save-wash " : ""
                            }${isSet ? "font-semibold text-accent-dim" : "text-body"}`}
                          />
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <p className="mt-3 text-sm text-clay">{error}</p>}
    </div>
  );
}
