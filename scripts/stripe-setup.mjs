#!/usr/bin/env node
// Creates the Stripe products, prices and founding coupons this app expects,
// then prints the env block to paste into .env.local (or Vercel).
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
//
// Idempotent: every object is looked up by a stable lookup_key / id before
// being created, so re-running finds what it made last time instead of
// creating duplicates. Run it once against test mode, then again against
// live mode when you're ready to charge real cards — they have separate
// objects and separate ids.
//
// Prices are immutable in Stripe. To change an amount, retire the price in
// the dashboard and give the new one a new lookup key here.

import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set.");
  process.exit(1);
}
const stripe = new Stripe(key);
const mode = key.startsWith("sk_live") ? "LIVE" : "test";

// Standard list prices, in cents. Founding sells these same prices with a
// 40% coupon — see src/lib/stripe.ts for why there is only one set.
// Extra seats are quoted per month on both plans ("+ $40/mo per additional
// designer seat"), so the annual seat price is 12x the monthly rate.
const PLAN = {
  base: { month: 20000, year: 200000 },
  seat: { month: 4000, year: 48000 },
};

// Every product needs a tax code: Stripe's Managed Payments (on by default
// on new accounts) makes Stripe the merchant of record and refuses to create
// a checkout session for a product it can't tax. "SaaS - business use" is
// what we sell — a cloud subscription to design firms.
const TAX_CODE = "txcd_10103001";

async function findOrCreateProduct(id, params) {
  try {
    const existing = await stripe.products.retrieve(id);
    // Products (unlike prices) are mutable, so a re-run repairs a product
    // created before this field was set.
    if (existing.tax_code !== TAX_CODE) {
      return await stripe.products.update(id, { tax_code: TAX_CODE });
    }
    return existing;
  } catch (err) {
    if (err.code !== "resource_missing") throw err;
    return await stripe.products.create({ id, tax_code: TAX_CODE, ...params });
  }
}

async function findOrCreatePrice(lookupKey, params) {
  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  if (existing.data.length > 0) return existing.data[0];
  return await stripe.prices.create({ lookup_key: lookupKey, ...params });
}

async function findOrCreateCoupon(id, params) {
  try {
    return await stripe.coupons.retrieve(id);
  } catch (err) {
    if (err.code !== "resource_missing") throw err;
    return await stripe.coupons.create({ id, ...params });
  }
}

async function main() {
  console.log(`Setting up Verde Vision billing in ${mode} mode…\n`);

  const baseProduct = await findOrCreateProduct("verde_vision_plan", {
    name: "Verde Vision",
    description:
      "Spatial landscape design for Apple Vision Pro. Includes 3 designer seats plus a free owner account.",
  });

  const seatProduct = await findOrCreateProduct("verde_vision_seat", {
    name: "Additional designer seat",
    description:
      "One extra designer login beyond the 3 seats included with every plan.",
  });

  const prices = {};
  for (const interval of ["month", "year"]) {
    prices[`base_${interval}`] = await findOrCreatePrice(
      `vv_base_${interval}`,
      {
        product: baseProduct.id,
        currency: "usd",
        unit_amount: PLAN.base[interval],
        recurring: { interval },
      }
    );
    // Seats are licensed (not metered): the quantity is the number of extra
    // designers, and Stripe prorates mid-term changes on its own — which is
    // what the pricing page promises for annual plans.
    prices[`seat_${interval}`] = await findOrCreatePrice(
      `vv_seat_${interval}`,
      {
        product: seatProduct.id,
        currency: "usd",
        unit_amount: PLAN.seat[interval],
        recurring: { interval },
      }
    );
  }

  // 40% off, applied to the whole subscription so base and seats both land
  // on the founding rate. Monthly repeats across the first 12 invoices;
  // annual uses `once` because one invoice already covers the founding year.
  const couponMonthly = await findOrCreateCoupon("vv_founding_monthly", {
    name: "Founding Partner — 40% off first year",
    percent_off: 40,
    duration: "repeating",
    duration_in_months: 12,
  });
  const couponAnnual = await findOrCreateCoupon("vv_founding_annual", {
    name: "Founding Partner — 40% off first year",
    percent_off: 40,
    duration: "once",
  });

  console.log("Done. Paste this into .env.local (and your Vercel env):\n");
  console.log(`STRIPE_PRICE_BASE_MONTHLY=${prices.base_month.id}`);
  console.log(`STRIPE_PRICE_BASE_ANNUAL=${prices.base_year.id}`);
  console.log(`STRIPE_PRICE_SEAT_MONTHLY=${prices.seat_month.id}`);
  console.log(`STRIPE_PRICE_SEAT_ANNUAL=${prices.seat_year.id}`);
  console.log(`STRIPE_COUPON_FOUNDING_MONTHLY=${couponMonthly.id}`);
  console.log(`STRIPE_COUPON_FOUNDING_ANNUAL=${couponAnnual.id}`);
  console.log(
    "\nStill needed: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, ADMIN_API_KEY."
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
