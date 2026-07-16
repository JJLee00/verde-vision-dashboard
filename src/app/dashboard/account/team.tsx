"use client";

// Team management for the org owner: invite designers (credentials shown
// exactly once) and remove them. Designers see the read-only list only —
// /api/team re-checks the owner role server-side regardless.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function InviteDesignerForm({ seatsLeft }: { seatsLeft: number }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{
    email: string;
    full_name: string;
    temp_password: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, full_name: fullName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not add the designer.");
        return;
      }
      setIssued(data);
      setFullName("");
      setEmail("");
      router.refresh();
    } catch {
      setError("Could not reach the server — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyCredentials() {
    if (!issued) return;
    await navigator.clipboard.writeText(
      `Verde Vision dashboard — dashboard.useverdevision.com\nEmail: ${issued.email}\nTemporary password: ${issued.temp_password}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const inputClass =
    "w-full rounded-lg border border-rule bg-card-hover px-3 py-2 text-sm text-body outline-none transition placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-60";

  return (
    <div className="mt-5 border-t border-rule pt-5">
      {issued && (
        <div className="mb-5 rounded-lg border border-accent/40 bg-accent-soft p-4">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-accent-dim">
            Account created — send these to {issued.full_name}
          </p>
          <dl className="mt-3 space-y-1.5 font-mono text-sm text-ink">
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-faint">Email</dt>
              <dd className="break-all">{issued.email}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-faint">Password</dt>
              <dd className="break-all font-semibold">{issued.temp_password}</dd>
            </div>
          </dl>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={copyCredentials}
              className="rounded-lg border border-rule-strong px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-card"
            >
              {copied ? "Copied ✓" : "Copy credentials"}
            </button>
            <p className="text-xs text-clay">
              This password won&apos;t be shown again.
            </p>
          </div>
        </div>
      )}

      {seatsLeft > 0 ? (
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={fullName}
            disabled={busy}
            required
            placeholder="Designer's name"
            aria-label="Designer's name"
            onChange={(e) => setFullName(e.target.value)}
            className={inputClass}
          />
          <input
            type="email"
            value={email}
            disabled={busy}
            required
            placeholder="name@example.com"
            aria-label="Designer's email"
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
          <button
            type="submit"
            disabled={busy}
            className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-cream transition hover:bg-accent-dim disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add designer"}
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted">
          All designer seats are in use. Contact Verde Vision to add more.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-clay">{error}</p>}
    </div>
  );
}

export function RemoveDesignerButton({
  userId,
  name,
}: {
  userId: string;
  name: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function remove() {
    if (
      !confirm(
        `Remove ${name} from the team? They lose dashboard access; their projects stay with your firm.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/team", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Could not remove them.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        disabled={busy}
        onClick={remove}
        className="text-[11px] font-semibold text-clay transition hover:opacity-75 disabled:opacity-50"
      >
        {busy ? "Removing…" : "Remove"}
      </button>
      {error && <p className="mt-1 text-xs text-clay">{error}</p>}
    </div>
  );
}
