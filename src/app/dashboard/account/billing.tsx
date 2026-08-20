"use client";

// Billing for the org owner: start a subscription, or jump into Stripe's
// hosted portal to change the card, seats, or plan. Designers never see this
// section, and /api/billing/* re-checks the owner role server-side regardless
// of what this UI renders.
//
// Every number shown here is last-known state written by the webhook. Stripe
// is the source of truth, which is why changes go through the portal rather
// than through forms here.

import { useState } from "react";
import type { Billing } from "@/lib/org";
import { INCLUDED_SEATS, PRICES } from "@/lib/plan";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const longDate = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const STATUS_LABEL: Record<Billing["status"], string> = {
  trial: "Free trial",
  active: "Active",
  past_due: "Payment failed",
  canceled: "Canceled",
};

const STATUS_STYLE: Record<Billing["status"], string> = {
  trial: "border-accent/40 bg-accent-soft text-accent-dim",
  active: "border-accent/40 bg-accent-soft text-accent-dim",
  past_due: "border-clay/40 bg-clay/10 text-clay",
  canceled: "border-rule-strong bg-card-hover text-muted",
};

export function BillingPanel({
  billing,
  maxDesigners,
}: {
  billing: Billing;
  maxDesigners: number;
}) {
  if (!billing.hasSubscription) {
    return <StartSubscription />;
  }

  const seatCost =
    billing.extraSeats > 0 && billing.interval
      ? PRICES[billing.interval].seat * billing.extraSeats
      : 0;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-full border px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] ${STATUS_STYLE[billing.status]}`}
        >
          {STATUS_LABEL[billing.status]}
        </span>
        {billing.plan && (
          <span className="text-sm font-semibold text-ink">
            {billing.plan === "founding" ? "Founding Partner" : "Standard"}
            {billing.interval === "year" ? " — annual" : " — monthly"}
          </span>
        )}
      </div>

      {billing.status === "past_due" && (
        <p className="mt-3 rounded-lg border border-clay/40 bg-clay/10 p-3 text-sm text-clay">
          We couldn&apos;t charge your card. Update it below to keep your team&apos;s
          access.
        </p>
      )}

      <dl className="mt-4 space-y-3">
        {billing.status === "trial" && billing.trialEndsAt && (
          <Row
            label="Trial ends"
            value={`${longDate.format(new Date(billing.trialEndsAt))} — cancel before then and you won't be charged`}
          />
        )}
        {billing.currentPeriodEnd && billing.status !== "canceled" && (
          <Row
            label={billing.status === "trial" ? "First payment" : "Renews"}
            value={longDate.format(new Date(billing.currentPeriodEnd))}
          />
        )}
        <Row
          label="Designer seats"
          value={
            billing.extraSeats > 0
              ? `${maxDesigners} — ${INCLUDED_SEATS} included plus ${billing.extraSeats} extra (${money.format(seatCost / 100)}/${billing.interval === "year" ? "yr" : "mo"})`
              : `${maxDesigners} included, plus your free owner account`
          }
        />
      </dl>

      <PortalButton />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-body">{value}</dd>
    </div>
  );
}

// Both buttons post to a route that returns a Stripe URL, then hand the
// browser over. Deliberately a full navigation, not a fetch — Stripe's pages
// can't be framed.
async function goToStripe(
  path: string,
  body: unknown,
  setError: (m: string | null) => void,
  setBusy: (b: boolean) => void
) {
  setBusy(true);
  setError(null);
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json();
    if (!res.ok || !data.url) {
      setError(data.error ?? "Could not reach Stripe — try again.");
      setBusy(false);
      return;
    }
    window.location.href = data.url;
  } catch {
    setError("Could not reach the server — try again.");
    setBusy(false);
  }
}

function PortalButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-5 border-t border-rule pt-5">
      <button
        type="button"
        disabled={busy}
        onClick={() => goToStripe("/api/billing/portal", {}, setError, setBusy)}
        className="rounded-lg border border-rule-strong px-4 py-2 text-sm font-semibold text-ink transition hover:bg-card-hover disabled:opacity-50"
      >
        {busy ? "Opening…" : "Manage billing"}
      </button>
      <p className="mt-2 text-xs text-muted">
        Update your card, add or remove seats, switch between monthly and
        annual, or cancel.
      </p>
      {error && <p className="mt-2 text-xs text-clay">{error}</p>}
    </div>
  );
}

function StartSubscription() {
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [extraSeats, setExtraSeats] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total =
    PRICES[interval].base + PRICES[interval].seat * extraSeats;

  return (
    <div className="mt-4">
      <p className="text-sm text-muted">
        Your firm doesn&apos;t have a subscription yet. Start your free 30-day
        trial — we&apos;ll take card details now and charge nothing until day 31.
      </p>

      <div className="mt-4 flex gap-2" role="group" aria-label="Billing period">
        {(["month", "year"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={interval === option}
            onClick={() => setInterval(option)}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
              interval === option
                ? "border-accent bg-accent-soft text-ink"
                : "border-rule text-muted hover:bg-card-hover"
            }`}
          >
            {option === "month" ? "Monthly" : "Annual"}
            {option === "year" && (
              <span className="ml-1.5 text-xs font-normal text-accent-dim">
                2 months free
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <label
          htmlFor="extra-seats"
          className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint"
        >
          Extra designer seats
        </label>
        <input
          id="extra-seats"
          type="number"
          min={0}
          max={50}
          value={extraSeats}
          disabled={busy}
          onChange={(e) =>
            setExtraSeats(Math.max(0, Math.min(50, Number(e.target.value) || 0)))
          }
          className="mt-1.5 block w-28 rounded-lg border border-rule bg-card-hover px-3 py-2 text-sm text-body outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-60"
        />
        <p className="mt-1.5 text-xs text-muted">
          {INCLUDED_SEATS} seats and your owner account are included.
        </p>
      </div>

      <p className="mt-4 text-sm text-body">
        <span className="font-semibold text-ink">
          {money.format(total / 100)}
        </span>
        {interval === "year" ? " per year" : " per month"} at the standard rate.
        Any founding discount you qualify for is applied at checkout.
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={() =>
          goToStripe(
            "/api/billing/checkout",
            { interval, extra_seats: extraSeats },
            setError,
            setBusy
          )
        }
        className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-cream transition hover:bg-accent-dim disabled:opacity-50"
      >
        {busy ? "Opening…" : "Start free trial"}
      </button>
      {error && <p className="mt-2 text-xs text-clay">{error}</p>}
    </div>
  );
}
