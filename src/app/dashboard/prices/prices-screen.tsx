import { LaborRates } from "./labor-rates";
import { PlantPriceGrid } from "./plant-price-grid";
import type { CatalogPlant } from "@/lib/price-stats";

export type StatTileData = { label: string; value: string };

// Shared layout for the Plant Prices and Hardscape Prices pages: stat
// tiles, labor-rates card, and the price grid. Each route passes its own
// catalog slice; extra cards (e.g. price sheets) come in as children.
export function PricesScreen({
  title,
  subtitle,
  laborNote,
  tiles,
  usageNote,
  setupNote,
  error,
  laborSizes,
  laborInitial,
  plants,
  sizes,
  pricesInitial,
  children,
}: {
  title: string;
  subtitle: string;
  laborNote: string;
  tiles: StatTileData[];
  usageNote: boolean;
  setupNote: string | null;
  error: string | null;
  laborSizes: string[];
  laborInitial: Record<string, number>;
  plants: CatalogPlant[];
  sizes: string[];
  pricesInitial: Record<string, number>;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-12 lg:py-10">
      <header>
        <h1 className="font-serif text-4xl text-ink">{title}</h1>
        <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
      </header>

      {setupNote && (
        <p className="mt-4 rounded-[10px] border border-edge bg-card px-4 py-3 text-sm text-clay">
          One-time setup needed: run{" "}
          <code className="font-mono text-xs">{setupNote}</code> in the
          Supabase SQL editor.
        </p>
      )}
      {error && (
        <p className="mt-4 text-sm text-clay">
          Could not load prices: {error}
        </p>
      )}

      <div
        className={`mt-8 grid gap-4 sm:grid-cols-2 ${
          tiles.length >= 4
            ? "lg:grid-cols-4"
            : tiles.length === 3
              ? "lg:grid-cols-3"
              : "lg:grid-cols-2"
        }`}
      >
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-[14px] border border-edge bg-card p-5 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]"
          >
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
              {tile.label}
            </p>
            <p className="mt-1.5 font-serif text-2xl text-ink">{tile.value}</p>
          </div>
        ))}
      </div>
      {usageNote && (
        <p className="mt-2 text-xs text-faint">
          Usage stats fill in as projects are exported from the headset.
        </p>
      )}

      <section className="mt-7 rounded-[14px] border border-edge bg-card p-6 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)] md:p-7">
        <h2 className="font-serif text-2xl text-ink">Labor rates</h2>
        <p className="mt-1 text-sm text-muted">{laborNote}</p>
        <div className="mt-5">
          <LaborRates sizes={laborSizes} initial={laborInitial} />
        </div>
      </section>

      <section className="mt-7 rounded-[14px] border border-edge bg-card p-6 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)] md:p-7">
        <h2 className="font-serif text-2xl text-ink">
          {title === "Plant Prices" ? "Plant prices" : "Item prices"}
        </h2>
        <p className="mt-1 text-sm text-muted">
          Your price per item, per size. Changes save as you go — blank cells
          fall back to Verde Vision&rsquo;s built-in pricing in estimates.
        </p>
        <div className="mt-5">
          <PlantPriceGrid
            plants={plants}
            sizes={sizes}
            initial={pricesInitial}
          />
        </div>
      </section>

      {children}
    </div>
  );
}
