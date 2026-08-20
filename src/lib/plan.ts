// Plan shape and list prices — plain data, no Stripe SDK. Separate from
// lib/stripe.ts so client components can show prices and seat counts without
// pulling the Stripe library (and its server-only env reads) into the
// browser bundle.

export type PlanId = "founding" | "standard";
export type Interval = "month" | "year";

// Seats bundled into every plan, on top of the free owner account.
// Mirrors the marketing copy: "3 designer seats plus a free owner account".
export const INCLUDED_SEATS = 3;

export const TRIAL_DAYS = 30;

// Standard list prices, in cents. Founding is these minus the 40% coupon —
// there is deliberately no second set of prices, so a founding firm rolling
// off its first year lands on the standard rate with no migration.
//
// Extra seats are quoted per month on both plans, so the annual seat price
// is 12x the monthly rate.
export const PRICES = {
  month: { base: 20000, seat: 4000 },
  year: { base: 200000, seat: 48000 },
} as const;
