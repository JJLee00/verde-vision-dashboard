"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  sizes: string[];
  initial: Record<string, number>;
};

// Labor rates by container size. Saves each field on blur (green wash),
// same as the plant grid. The page passes the size subset — gallon/box
// on Plant Prices, Small/Medium/Large on Hardscape Prices.
export function LaborRates({ sizes, initial }: Props) {
  const seed = () =>
    Object.fromEntries(sizes.map((s) => [s, initial[s]?.toFixed(2) ?? ""]));

  const [draft, setDraft] = useState<Record<string, string>>(seed);
  const [saved, setSaved] = useState<Record<string, string>>(seed);
  const [washSize, setWashSize] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function commit(size: string) {
    const value = (draft[size] ?? "").trim();
    if (value === (saved[size] ?? "")) return;
    setError(null);

    const supabase = createClient();
    try {
      if (value === "") {
        const { error: deleteError } = await supabase
          .from("labor_rates")
          .delete()
          .eq("size", size);
        if (deleteError) throw new Error(deleteError.message);
        setSaved((prev) => {
          const next = { ...prev };
          delete next[size];
          return next;
        });
        setDraft((prev) => ({ ...prev, [size]: "" }));
      } else {
        const rate = Number(value);
        if (Number.isNaN(rate) || rate < 0) {
          setError(`"${value}" isn't a valid rate.`);
          return;
        }
        const { error: upsertError } = await supabase
          .from("labor_rates")
          .upsert({ size, rate }, { onConflict: "user_id,size" });
        if (upsertError) throw new Error(upsertError.message);
        setSaved((prev) => ({ ...prev, [size]: rate.toFixed(2) }));
        setDraft((prev) => ({ ...prev, [size]: rate.toFixed(2) }));
      }
      setWashSize(size);
      setTimeout(() => setWashSize((s) => (s === size ? null : s)), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save rate.");
    }
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-sm tabular-nums">
          <thead>
            <tr>
              {sizes.map((size) => (
                <th
                  key={size}
                  className="w-28 border border-ink/20 bg-clay px-2.5 py-2 text-right text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-on-clay"
                >
                  <label htmlFor={`labor-${size}`}>{size}</label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {sizes.map((size) => (
                <td key={size} className="relative border border-ink/20 p-0">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-faint">
                    $
                  </span>
                  <input
                    id={`labor-${size}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft[size] ?? ""}
                    onChange={(e) => setDraft({ ...draft, [size]: e.target.value })}
                    onBlur={() => commit(size)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    aria-label={`${size} labor rate`}
                    className={`no-spinner block h-9 w-full bg-transparent pl-6 pr-2.5 text-right text-sm outline-none focus:bg-card-hover focus:outline-2 focus:-outline-offset-2 focus:outline-accent ${
                      washSize === size ? "save-wash " : ""
                    }${
                      (saved[size] ?? "") !== ""
                        ? "font-semibold text-accent-dim"
                        : "text-body"
                    }`}
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {error && <p className="mt-2 text-sm text-clay">{error}</p>}
    </div>
  );
}
