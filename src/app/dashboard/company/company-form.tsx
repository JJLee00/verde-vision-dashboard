"use client";

// Same editing grammar as the Prices tab and the project record: commit on
// blur, optimistic, roll back and explain on failure, green wash on success.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type CompanyProfile = {
  name: string;
  logoPath: string | null;
  logoUrl: string | null;
  phone: string;
  email: string;
  address: string;
  website: string;
  licenseNumber: string;
  terms: string;
};

// pdfkit decodes PNG and JPEG and nothing else. A WebP or SVG logo would
// upload happily and then be silently skipped on every proposal, so it gets
// refused here where the designer can see why.
const LOGO_TYPES = ["image/png", "image/jpeg"];
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

// A starting point for a company with nothing written down — meant to be
// edited, not signed as-is.
const STARTER_TERMS = `Estimate valid for 30 days from the date above. A deposit is due on acceptance; the balance is due on completion. Plant material is warranted for 90 days from installation when the watering schedule provided is followed. Prices assume normal digging conditions — rock, caliche, or unmarked utilities may require a change order. Any change to the scope above will be quoted in writing before the work is performed.`;

type FieldKey =
  | "name"
  | "phone"
  | "email"
  | "address"
  | "website"
  | "license_number"
  | "terms";

const FIELDS: { key: FieldKey; label: string; placeholder: string; hint?: string }[] = [
  { key: "name", label: "Company name", placeholder: "Verde Landscaping Inc." },
  { key: "phone", label: "Phone", placeholder: "(480) 555-0142" },
  { key: "email", label: "Email", placeholder: "office@yourcompany.com" },
  { key: "website", label: "Website", placeholder: "yourcompany.com" },
  { key: "address", label: "Address", placeholder: "Rio Verde, AZ" },
  {
    key: "license_number",
    label: "License number",
    placeholder: "ROC #307998",
    hint: "Prints as “License …”. ROC in Arizona; whatever your state issues.",
  },
];

export function CompanyForm({
  orgId,
  initial,
  canEdit,
  isOwner,
  schemaReady,
}: {
  orgId: string;
  initial: CompanyProfile;
  canEdit: boolean;
  isOwner: boolean;
  schemaReady: boolean;
}) {
  const [draft, setDraft] = useState({
    name: initial.name,
    phone: initial.phone,
    email: initial.email,
    address: initial.address,
    website: initial.website,
    license_number: initial.licenseNumber,
    terms: initial.terms,
  });
  const [saved, setSaved] = useState(draft);
  const [wash, setWash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function commit(key: FieldKey) {
    const value = draft[key].trim();
    if (value === saved[key].trim()) return;
    // The company name is the one field a document can't do without.
    if (key === "name" && value === "") {
      setDraft((d) => ({ ...d, name: saved.name }));
      return;
    }
    setError(null);

    const { error: err } = await createClient()
      .from("organizations")
      .update({ [key]: value || null })
      .eq("id", orgId);
    if (err) {
      setDraft((d) => ({ ...d, [key]: saved[key] }));
      setError(
        isOwner
          ? "Could not save — try again."
          : "Only an owner can change the company profile."
      );
      return;
    }
    setSaved((s) => ({ ...s, [key]: value }));
    setWash(key);
    setTimeout(() => setWash((w) => (w === key ? null : w)), 1000);
  }

  const field = (key: FieldKey) =>
    `w-full rounded-lg border bg-card-hover px-3 py-2 text-sm text-body outline-none transition placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-60 ${
      wash === key ? "save-wash " : ""
    }${saved[key].trim() ? "border-accent/40" : "border-rule"}`;

  return (
    <div className="mt-7 grid max-w-5xl gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        <section className="rounded-[14px] border border-edge bg-card p-6 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
          <h2 className="font-serif text-xl text-ink">Letterhead</h2>
          <p className="mt-1.5 text-sm text-muted">
            Anything you leave blank is simply left off the document.
          </p>

          <LogoUpload
            orgId={orgId}
            logoPath={initial.logoPath}
            logoUrl={initial.logoUrl}
            disabled={!canEdit}
            onError={setError}
          />

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <div key={f.key} className={f.key === "address" ? "sm:col-span-2" : ""}>
                <label
                  htmlFor={`org-${f.key}`}
                  className="block text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted"
                >
                  {f.label}
                </label>
                <input
                  id={`org-${f.key}`}
                  value={draft[f.key]}
                  disabled={!canEdit}
                  placeholder={f.placeholder}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [f.key]: e.target.value }))
                  }
                  onBlur={() => void commit(f.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  className={`mt-1.5 ${field(f.key)}`}
                />
                {f.hint && (
                  <p className="mt-1 text-[0.68rem] text-faint">{f.hint}</p>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[14px] border border-edge bg-card p-6 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-serif text-xl text-ink">Standard terms</h2>
            {canEdit && draft.terms.trim() === "" && (
              <button
                type="button"
                onClick={() => {
                  setDraft((d) => ({ ...d, terms: STARTER_TERMS }));
                }}
                className="text-xs font-semibold text-accent transition hover:text-accent-bright"
              >
                Insert a starting point
              </button>
            )}
          </div>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">
            Printed at the foot of every estimate. Deposit and payment timing,
            plant warranty, what triggers a change order — the paragraph you
            currently have to explain out loud on every job. Any single
            estimate can override this from its own page.
          </p>

          <textarea
            id="org-terms"
            value={draft.terms}
            disabled={!canEdit}
            rows={8}
            placeholder="Estimate valid for 30 days…"
            onChange={(e) => setDraft((d) => ({ ...d, terms: e.target.value }))}
            onBlur={() => void commit("terms")}
            aria-label="Standard terms"
            className={`mt-4 resize-y leading-relaxed ${field("terms")}`}
          />
          <p className="mt-2 text-[0.68rem] text-faint">
            The starter is a template to edit, not legal advice — read it
            against how you actually work, and have someone qualified look at
            it before you rely on it.
          </p>
        </section>
      </div>

      <aside className="h-fit space-y-4">
        {error && (
          <p className="rounded-lg border border-clay/40 bg-clay/[0.08] px-4 py-2.5 text-sm text-clay">
            {error}
          </p>
        )}
        {!isOwner && schemaReady && (
          <p className="rounded-[14px] border border-edge bg-card p-5 text-sm text-muted">
            Only an owner can change the company profile. This is what your
            proposals currently say.
          </p>
        )}
        <section className="rounded-[14px] border border-edge bg-card p-5 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
          <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-faint">
            How it prints
          </h2>
          <Preview draft={draft} logoUrl={initial.logoUrl} />
          <p className="mt-4 border-t border-rule pt-3 text-[0.68rem] leading-relaxed text-faint">
            Documents print on white with your details top-left. Verde Vision
            appears only as a small line in the footer.
          </p>
        </section>
      </aside>
    </div>
  );
}

/* ── Letterhead preview ───────────────────────────────────────────────── */

function Preview({
  draft,
  logoUrl,
}: {
  draft: Record<string, string>;
  logoUrl: string | null;
}) {
  const contact = [draft.address, draft.phone, draft.email, draft.website]
    .map((v) => v.trim())
    .filter(Boolean);

  return (
    <div className="mt-3 rounded-lg border border-rule bg-white p-4">
      {logoUrl && (
        // Deliberately a plain <img>: next/image wants the bucket host in
        // remotePatterns, and this is a 130px preview of a file the user
        // just uploaded.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          className="mb-2 h-8 w-auto max-w-[130px] object-contain object-left"
        />
      )}
      <p className="text-[0.82rem] font-bold text-ink">
        {draft.name.trim() || "Your company name"}
      </p>
      {contact.length > 0 && (
        <p className="mt-1 text-[0.62rem] leading-relaxed text-muted">
          {contact.join("  ·  ")}
        </p>
      )}
      {draft.license_number.trim() && (
        <p className="text-[0.62rem] text-muted">
          License {draft.license_number.trim()}
        </p>
      )}
      <div className="mt-2 border-t border-accent pt-2">
        <p className="text-right font-serif text-base text-accent">Estimate</p>
      </div>
    </div>
  );
}

/* ── Logo ─────────────────────────────────────────────────────────────── */

function LogoUpload({
  orgId,
  logoPath,
  logoUrl,
  disabled,
  onError,
}: {
  orgId: string;
  logoPath: string | null;
  logoUrl: string | null;
  disabled: boolean;
  onError: (message: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function upload(file: File) {
    if (!LOGO_TYPES.includes(file.type)) {
      onError("Logo must be a PNG or JPEG — those are what a PDF can embed.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      onError("Logo is over 5 MB.");
      return;
    }
    setBusy(true);
    onError(null);
    const supabase = createClient();
    const ext = file.type === "image/png" ? "png" : "jpg";
    // Path is {org_id}/… so the storage policy's folder check IS the org
    // check. Timestamped so a replacement never fights a cached URL.
    const path = `${orgId}/logo-${Date.now()}.${ext}`;
    try {
      const { error: uploadError } = await supabase.storage
        .from("org-assets")
        .upload(path, file, { contentType: file.type });
      if (uploadError) throw new Error(uploadError.message);

      const { error: updateError } = await supabase
        .from("organizations")
        .update({ logo_path: path })
        .eq("id", orgId);
      if (updateError) throw new Error(updateError.message);

      // Only once the row points at the new file — an orphaned object is
      // untidy, a broken logo on a live proposal is not.
      if (logoPath) {
        await supabase.storage.from("org-assets").remove([logoPath]);
      }
      router.refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!logoPath) return;
    setBusy(true);
    onError(null);
    const supabase = createClient();
    try {
      const { error: updateError } = await supabase
        .from("organizations")
        .update({ logo_path: null })
        .eq("id", orgId);
      if (updateError) throw new Error(updateError.message);
      await supabase.storage.from("org-assets").remove([logoPath]);
      router.refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not remove logo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 flex flex-wrap items-center gap-4 rounded-lg border border-rule bg-card-hover/60 p-4">
      <div className="flex h-16 w-32 items-center justify-center rounded border border-rule bg-white">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt="Company logo"
            className="max-h-14 max-w-28 object-contain"
          />
        ) : (
          <span className="text-[0.62rem] uppercase tracking-[0.14em] text-faint">
            No logo
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
            className="rounded-lg border border-rule-strong bg-paper-deep px-3 py-1.5 text-[13px] font-semibold text-ink transition hover:bg-card-hover disabled:opacity-50"
          >
            {busy ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
          </button>
          {logoUrl && (
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => void remove()}
              className="rounded-lg px-2 py-1.5 text-[13px] font-semibold text-muted transition hover:text-clay disabled:opacity-40"
            >
              Remove
            </button>
          )}
        </div>
        <p className="mt-2 text-[0.68rem] leading-relaxed text-faint">
          PNG or JPEG, up to 5 MB. A wide logo on a transparent or white
          background reads best — it prints about 1.8 inches across.
        </p>
      </div>
    </div>
  );
}
