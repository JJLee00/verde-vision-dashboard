// The estimate as rows: types, labels, and the money math.
//
// Deliberately pure and free of React or Supabase imports — the PDF
// generator (plan doc §8) has to produce byte-identical totals to what the
// designer saw on screen, and the only way to guarantee that is for both to
// call these functions.
//
// An estimate is ONE FLAT LIST of rows (decided Sep 25 2026). `category` is a
// tag, not structure: it drives the Saved Items picker and lets the client PDF
// roll rows up into lump sums without the editor nesting anything.

export const CATEGORIES = [
  "plant",
  "hardscape",
  "irrigation",
  "demolition",
  "labor",
  "material",
  "service",
  "equipment",
  "delivery",
  "fee",
  "other",
] as const;

export type EstimateCategory = (typeof CATEGORIES)[number];

// What each tag is called on screen, and the heading it becomes when the
// client PDF is set to grouped lump sums.
export const CATEGORY_LABELS: Record<EstimateCategory, string> = {
  plant: "Planting",
  hardscape: "Hardscape",
  irrigation: "Irrigation",
  demolition: "Demolition & haul-off",
  labor: "Labor",
  material: "Materials",
  service: "Services",
  equipment: "Equipment",
  delivery: "Delivery",
  fee: "Fees",
  other: "Other",
};

// Not a database check constraint: the next unit a landscaper needs isn't
// predictable, and a failed insert mid-bid is worse than an odd unit string.
// These are just the suggestions in the dropdown.
export const UNITS = ["each", "hr", "ft²", "yd³", "load", "trip", "ls"] as const;

export type EstimateSource = "ar" | "manual";

export type EstimateItem = {
  id: string;
  sortOrder: number;
  description: string;
  category: EstimateCategory;
  quantity: number;
  unit: string;
  unitPrice: number;
  // Generated in Postgres (quantity × unit_price). Recomputed locally for
  // optimistic rendering, never sent on a write.
  total: number;
  taxable: boolean;
  note: string | null;
  source: EstimateSource;
  arKey: string | null;
  priceOverridden: boolean;
};

export type EstimateSettings = {
  // Percent, e.g. 8.6 — not a fraction.
  taxRate: number;
  depositPercent: number;
  detail: "itemized" | "grouped";
};

export type EstimateTotals = {
  subtotal: number;
  taxableSubtotal: number;
  tax: number;
  total: number;
  deposit: number;
  balance: number;
};

// Currency arithmetic: round at every boundary a human will read, so the
// printed lines always add up to the printed total.
export const round2 = (n: number): number => Math.round(n * 100) / 100;

export function lineTotal(item: Pick<EstimateItem, "quantity" | "unitPrice">) {
  return round2(item.quantity * item.unitPrice);
}

export function computeTotals(
  items: EstimateItem[],
  settings: EstimateSettings
): EstimateTotals {
  const subtotal = round2(items.reduce((sum, i) => sum + i.total, 0));
  const taxableSubtotal = round2(
    items.reduce((sum, i) => (i.taxable ? sum + i.total : sum), 0)
  );
  const tax = round2((taxableSubtotal * settings.taxRate) / 100);
  const total = round2(subtotal + tax);
  const deposit = round2((total * settings.depositPercent) / 100);
  return {
    subtotal,
    taxableSubtotal,
    tax,
    total,
    deposit,
    balance: round2(total - deposit),
  };
}

export type CategoryGroup = {
  category: EstimateCategory;
  label: string;
  total: number;
  lineCount: number;
};

// The grouped (lump-sum) view of the same rows, in CATEGORIES order with
// empty categories dropped. Its totals sum to computeTotals().subtotal by
// construction — the two PDF modes must never disagree on the bottom line.
export function groupByCategory(items: EstimateItem[]): CategoryGroup[] {
  return CATEGORIES.flatMap((category) => {
    const rows = items.filter((i) => i.category === category);
    if (rows.length === 0) return [];
    return [
      {
        category,
        label: CATEGORY_LABELS[category],
        total: round2(rows.reduce((sum, i) => sum + i.total, 0)),
        lineCount: rows.length,
      },
    ];
  });
}

// Rows are spaced by 10 so moving one is a single UPDATE to a midpoint
// instead of renumbering the whole bid.
export const SORT_GAP = 10;

export function nextSortOrder(items: EstimateItem[]): number {
  if (items.length === 0) return SORT_GAP;
  return Math.max(...items.map((i) => i.sortOrder)) + SORT_GAP;
}

// Where a row dropped between `before` and `after` should sort. Returns null
// when the gap has closed and the caller needs to renumber the project's rows
// by 10s before it can place anything there.
export function midpointSortOrder(
  before: number | null,
  after: number | null
): number | null {
  if (before == null && after == null) return SORT_GAP;
  if (before == null) return after! - SORT_GAP;
  if (after == null) return before + SORT_GAP;
  if (after - before < 2) return null;
  return Math.floor((before + after) / 2);
}

// Sorted by the designer's order, with a stable tiebreak so two rows that
// share a sort_order (possible after a renumber race) don't swap places on
// every render.
export function sortItems(items: EstimateItem[]): EstimateItem[] {
  return [...items].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
  );
}

// Row shape as it comes back from Supabase.
type Row = {
  id: string;
  sort_order: number;
  description: string;
  category: string;
  quantity: string | number;
  unit: string;
  unit_price: string | number;
  total: string | number;
  taxable: boolean;
  note: string | null;
  source: string;
  ar_key: string | null;
  price_overridden: boolean;
};

// numeric columns arrive from PostgREST as strings — Number() them here,
// once, rather than at every read site.
export function fromRow(row: Row): EstimateItem {
  return {
    id: row.id,
    sortOrder: row.sort_order,
    description: row.description,
    category: (CATEGORIES as readonly string[]).includes(row.category)
      ? (row.category as EstimateCategory)
      : "other",
    quantity: Number(row.quantity),
    unit: row.unit,
    unitPrice: Number(row.unit_price),
    total: Number(row.total),
    taxable: row.taxable,
    note: row.note,
    source: row.source === "ar" ? "ar" : "manual",
    arKey: row.ar_key,
    priceOverridden: row.price_overridden,
  };
}
