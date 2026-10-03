"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StoredBlueprint } from "@/lib/blueprint/stored";
import { sameAddress } from "@/lib/blueprint/stored";
import {
  findLots,
  pickLot,
  removeHouseOutline,
  type LotChoice,
} from "./house-outline-actions";
import { LotThumbnail, OutlineMap } from "./outline-map";

/**
 * The lot and house outline the headset will walk, picked at a desk.
 *
 * This used to happen in the headset, in the driveway: confirm the address,
 * pick the lot, wait on the yard's connection while the aerial downloads.
 * Here it is one click in the common case — a single lot for the address goes
 * straight to tracing — and the headset receives the result with its project
 * list, so on site Blueprint opens directly on the corner walk.
 */
export function HouseOutline({
  projectId,
  address,
  outline,
  ready,
  disabled,
}: {
  projectId: string;
  address: string | null;
  outline: {
    stored: StoredBlueprint;
    fetchedAt: string | null;
    orthoUrl: string | null;
  } | null;
  /** False until migration-020 has been run. */
  ready: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const [lots, setLots] = useState<LotChoice[] | null>(null);
  const [phase, setPhase] = useState<"idle" | "finding" | "tracing" | "removing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const busy = phase !== "idle";

  async function trace(apn: string) {
    setPhase("tracing");
    setError(null);
    const result = await pickLot(projectId, apn);
    if (!result.ok) {
      setError(result.error);
      setPhase("idle");
      return;
    }
    setLots(null);
    startTransition(() => router.refresh());
    setPhase("idle");
  }

  async function find() {
    setPhase("finding");
    setError(null);
    const result = await findLots(projectId);
    if (!result.ok) {
      setError(result.error);
      setPhase("idle");
      return;
    }
    // One lot for the address is the normal case — there is nothing to
    // choose, so go straight on to the part worth looking at: the house.
    if (result.lots.length === 1) {
      await trace(result.lots[0].apn);
      return;
    }
    setLots(result.lots);
    setPhase("idle");
  }

  async function remove() {
    setPhase("removing");
    setError(null);
    const result = await removeHouseOutline(projectId);
    if (!result.ok) setError(result.error);
    else startTransition(() => router.refresh());
    setPhase("idle");
  }

  if (!ready) {
    return (
      <p className="text-sm text-muted">
        Run migration-020 in Supabase and lot outlines can be looked up here.
      </p>
    );
  }

  const stored = outline?.stored ?? null;
  const addressChanged = stored != null && !sameAddress(stored.lookupAddress, address);

  return (
    <div>
      {stored ? (
        <PickedOutline
          stored={stored}
          fetchedAt={outline?.fetchedAt ?? null}
          orthoUrl={outline?.orthoUrl ?? null}
        />
      ) : !address ? (
        <p className="text-sm text-muted">
          Add the property address with <span className="font-semibold">Edit details</span>{" "}
          and the lot and house can be looked up here, so the headset arrives on
          site with the outline already in hand.
        </p>
      ) : (
        !lots && (
          <p className="text-sm text-muted">
            Looks up <span className="text-body">{address}</span> with the county
            and traces the house from the latest aerial. The headset picks it up
            on its next sync — nothing to type on site.
          </p>
        )
      )}

      {addressChanged && !lots && (
        <p className="mt-4 rounded-lg border border-gold/40 bg-gold/10 px-3.5 py-2.5 text-sm text-gold">
          Picked for “{stored!.lookupAddress}”. The project&apos;s address has
          changed since — look it up again so the headset walks the right house.
        </p>
      )}

      {lots && (
        <div className="mt-1">
          <p className="text-sm text-muted">
            {lots.length} lots share this address. Which one is the project?
          </p>
          <ul className="mt-3 flex flex-col gap-2.5">
            {lots.map((lot) => (
              <li key={lot.apn}>
                <button
                  type="button"
                  disabled={busy || disabled}
                  onClick={() => trace(lot.apn)}
                  className="flex w-full items-center gap-4 rounded-[10px] border border-rule bg-card p-2.5 text-left transition hover:border-accent hover:bg-card-hover disabled:opacity-50"
                >
                  <LotThumbnail parcelXZ={lot.parcelXZ} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">
                      {lot.address}
                    </span>
                    <span className="mt-0.5 block text-sm text-muted">
                      {[
                        lot.lotSizeSqFt != null && `${formatArea(lot.lotSizeSqFt)} lot`,
                        lot.livableAreaSqFt != null &&
                          `${formatArea(lot.livableAreaSqFt)} home`,
                        lot.constructionYear != null && `built ${lot.constructionYear}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span className="mt-0.5 block font-mono text-[11px] text-faint">
                      APN {lot.apn}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {phase === "finding" && (
        <p className="mt-4 text-sm text-muted">Finding the lot…</p>
      )}
      {phase === "tracing" && (
        <p className="mt-4 text-sm text-muted">
          Tracing the house from the aerial — about fifteen seconds.
        </p>
      )}
      {error && <p className="mt-4 text-sm text-clay">{error}</p>}

      {!disabled && address && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {(!stored || addressChanged) && !lots && (
            <button
              type="button"
              disabled={busy}
              onClick={find}
              className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-paper transition hover:bg-accent-bright disabled:opacity-50"
            >
              {stored ? "Look up again" : "Find the house"}
            </button>
          )}
          {stored && !addressChanged && !lots && (
            <button
              type="button"
              disabled={busy}
              onClick={find}
              className="rounded-lg border border-rule-strong px-4 py-2 text-sm font-semibold text-body transition hover:border-accent hover:text-accent disabled:opacity-50"
            >
              Wrong lot? Pick again
            </button>
          )}
          {lots && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setLots(null)}
              className="text-sm font-semibold text-muted transition hover:text-ink disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          {stored && !lots && (
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="text-sm font-semibold text-muted transition hover:text-clay disabled:opacity-50"
            >
              {phase === "removing" ? "Removing…" : "Remove"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PickedOutline({
  stored,
  fetchedAt,
  orthoUrl,
}: {
  stored: StoredBlueprint;
  fetchedAt: string | null;
  orthoUrl: string | null;
}) {
  const c = stored.candidate;
  const house = c.houseXZ ?? null;
  const imagery = c.imagery ?? null;
  // Shown wherever the imagery is: in this market tiles run years behind,
  // and the date is how a designer knows to distrust a pool or patio.
  const captured = imagery?.captureDate ? formatMonthYear(imagery.captureDate) : null;
  // The headset reports its own trouble; this list is what the designer
  // should know BEFORE driving out. The not-configured case never gets here
  // (pickLot refuses it), so these are all about the property.
  const warnings = (c.warnings ?? []).filter(
    (w) => !(w.code === "footprint-unavailable" && house == null)
  );

  return (
    <div>
      <div className="overflow-hidden rounded-[10px] border border-rule">
        <OutlineMap candidate={c} orthoUrl={orthoUrl} className="block h-auto w-full max-h-[460px]" />
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <Fact label="House">
          {house
            ? `${house.length} corners${
                c.houseAreaSqFt != null ? ` · ${formatArea(c.houseAreaSqFt)} roofed` : ""
              }`
            : "Not found in the aerial"}
        </Fact>
        <Fact label="Imagery">
          {captured ? `${captured}${imagery?.quality ? ` · ${imagery.quality.toLowerCase()} detail` : ""}` : "None"}
        </Fact>
        <Fact label="Lot">
          {[
            c.attributes.lotSizeSqFt != null && formatArea(c.attributes.lotSizeSqFt),
            `APN ${c.apn}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Fact>
        {fetchedAt && (
          <Fact label="Picked">
            {new Date(fetchedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </Fact>
        )}
      </dl>

      {!house && (
        <p className="mt-3 text-sm text-muted">
          No house could be traced on this lot, so the headset will align to
          the lot corners instead — tax-map lines are only good to a few feet.
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {warnings.map((w, i) => (
            <li key={i} className="text-sm text-gold">
              {w.message}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-faint">
        Corners follow the roofline, so expect them a foot or two outside the
        walls. On site, the headset has you walk two of them to drop the
        outline into the yard.
      </p>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-faint">{label}</dt>
      <dd className="min-w-0 text-body">{children}</dd>
    </div>
  );
}

function formatArea(sqFt: number): string {
  if (sqFt >= 43560 * 0.5) return `${(sqFt / 43560).toFixed(2)} ac`;
  return `${Math.round(sqFt).toLocaleString("en-US")} sq ft`;
}

function formatMonthYear(iso: string): string {
  // Solar returns a bare date ("2022-03-14"); parse it as a calendar date so
  // a UTC-midnight timestamp doesn't render as the previous month.
  const [y, m] = iso.split("-").map(Number);
  if (!y || !m) return iso;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}
