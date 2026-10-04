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
        <p className="mt-4 border border-ink/20 bg-card px-4 py-3 text-sm text-clay">
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
            className="border border-ink/20 bg-card p-4"
          >
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
              {tile.label}
            </p>
            <p className="mt-1 text-xl font-semibold text-ink">{tile.value}</p>
          </div>
        ))}
      </div>
      {usageNote && (
        <p className="mt-2 text-xs text-faint">
          Usage stats fill in as projects are exported from the headset.
        </p>
      )}

      <section className="mt-7 border border-ink/20 bg-card p-5">
        <h2 className="text-base font-semibold text-ink">Labor rates</h2>
        <p className="mt-1 text-sm text-muted">
          {laborNote} A blank rate is $0.
        </p>
        <div className="mt-5">
          <LaborRates sizes={laborSizes} initial={laborInitial} />
        </div>
      </section>

      <section className="mt-7 border border-ink/20 bg-card p-5">
        <h2 className="text-base font-semibold text-ink">
          {title === "Plant Prices" ? "Plant prices" : "Item prices"}
        </h2>
        <p className="mt-1 text-sm text-muted">
          Your price per item, per size. Changes save as you go. A blank cell
          is $0 — on estimates and in the headset. A change prices new lines;
          lines already on an estimate keep the price they were given.
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
