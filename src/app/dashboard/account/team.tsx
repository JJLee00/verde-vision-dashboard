"use client";

// Team management for the org owner: invite designers, reset a designer's
// password, and remove them. Credentials (from an invite or a reset) are
// shown exactly once, in a single shared panel. Designers see the
// read-only roster only — /api/team re-checks the owner role server-side
// regardless of what this UI renders.

import { useState } from "react";
import { useRouter } from "next/navigation";

export type MemberLite = {
  userId: string;
  name: string;
  email: string | null;
  role: "owner" | "designer";
};

type Issued = {
  kind: "invited" | "reset";
  email: string;
  full_name: string;
  temp_password: string;
};

export function TeamManager({
  members,
  currentUserId,
  isOwner,
  seatsLeft,
}: {
  members: MemberLite[];
  currentUserId: string;
  isOwner: boolean;
  seatsLeft: number;
}) {
  const [issued, setIssued] = useState<Issued | null>(null);

  return (
    <>
      {issued && <CredentialsPanel issued={issued} />}

      <ul className="mt-4 divide-y divide-rule">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">
                {m.name}
                {m.userId === currentUserId && (
                  <span className="ml-1.5 text-xs font-normal text-faint">
                    (you)
                  </span>
                )}
              </p>
              {m.email && (
                <p className="truncate text-xs text-muted">{m.email}</p>
              )}
            </div>
            <span
              className={`shrink-0 rounded-full border px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] ${
                m.role === "owner"
                  ? "border-gold/40 bg-gold/10 text-gold"
                  : "border-accent/40 bg-accent-soft text-accent-dim"
              }`}
            >
              {m.role}
            </span>
            {isOwner && m.role === "designer" && (
              <DesignerActions
                userId={m.userId}
                name={m.name}
                onIssued={setIssued}
              />
            )}
          </li>
        ))}
      </ul>

      {isOwner ? (
        <InviteDesignerForm seatsLeft={seatsLeft} onIssued={setIssued} />
      ) : (
        <p className="mt-5 border-t border-rule pt-5 text-sm text-muted">
          Your account owner manages the team.
        </p>
      )}
    </>
  );
}

function CredentialsPanel({ issued }: { issued: Issued }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(
      `Verde Vision dashboard — dashboard.useverdevision.com\nEmail: ${issued.email}\nTemporary password: ${issued.temp_password}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="mb-2 mt-5 rounded-lg border border-accent/40 bg-accent-soft p-4">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-accent-dim">
        {issued.kind === "invited"
          ? `Account created — send these to ${issued.full_name}`
          : `Password reset — send these to ${issued.full_name}`}
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
          onClick={copy}
          className="rounded-lg border border-rule-strong px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-card"
        >
          {copied ? "Copied ✓" : "Copy credentials"}
        </button>
        <p className="text-xs text-clay">This password won&apos;t be shown again.</p>
      </div>
    </div>
  );
}

function DesignerActions({
  userId,
  name,
  onIssued,
}: {
  userId: string;
  name: string;
  onIssued: (i: Issued) => void;
}) {
  const [busy, setBusy] = useState<"reset" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function reset() {
    if (
      !confirm(
        `Reset ${name}'s password? Their current password stops working and you'll get a new one to hand them.`
      )
    )
      return;
    setBusy("reset");
    setError(null);
    try {
      const res = await fetch("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not reset the password.");
        return;
      }
      onIssued({ kind: "reset", ...data });
    } catch {
      setError("Could not reach the server — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (
      !confirm(
        `Remove ${name} from the team? They lose dashboard access; their projects stay with your firm.`
      )
    )
      return;
    setBusy("remove");
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
      setBusy(null);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy !== null}
          onClick={reset}
          className="text-[11px] font-semibold text-accent-dim transition hover:opacity-75 disabled:opacity-50"
        >
          {busy === "reset" ? "Resetting…" : "Reset password"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={remove}
          className="text-[11px] font-semibold text-clay transition hover:opacity-75 disabled:opacity-50"
        >
          {busy === "remove" ? "Removing…" : "Remove"}
        </button>
      </div>
      {error && <p className="text-xs text-clay">{error}</p>}
    </div>
  );
}

function InviteDesignerForm({
  seatsLeft,
  onIssued,
}: {
  seatsLeft: number;
  onIssued: (i: Issued) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      onIssued({ kind: "invited", ...data });
      setFullName("");
      setEmail("");
      router.refresh();
    } catch {
      setError("Could not reach the server — try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-rule bg-card-hover px-3 py-2 text-sm text-body outline-none transition placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-60";

  return (
    <div className="mt-5 border-t border-rule pt-5">
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
