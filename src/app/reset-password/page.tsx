"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// Reached from the password-reset email → /auth/callback (which exchanges
// the code for a recovery session) → here. The user is signed in with a
// short-lived recovery session and just needs to set a new password.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setHasSession(Boolean(data.user));
      setChecking(false);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setDone(true);
    setLoading(false);
    setTimeout(() => {
      router.push("/dashboard");
      router.refresh();
    }, 1200);
  }

  const inputClass =
    "mt-2 w-full rounded-lg border border-edge bg-card-hover px-3.5 py-2.5 text-body outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft";
  const labelClass =
    "block text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted";

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-md rounded-[14px] border border-edge bg-card p-10 shadow-[0_18px_40px_-18px_rgba(28,42,33,0.25)]">
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-accent">
          Verde Vision
        </p>
        <h1 className="mt-3 font-serif text-3xl text-ink">Set a new password</h1>

        {checking ? (
          <p className="mt-6 text-sm text-muted">Checking your link…</p>
        ) : !hasSession ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted">
              This reset link is invalid or has expired. Request a new one from
              the login screen.
            </p>
            <Link
              href="/login"
              className="inline-block text-sm font-semibold text-accent transition hover:text-accent-bright"
            >
              ← Back to sign in
            </Link>
          </div>
        ) : done ? (
          <p className="mt-6 rounded-lg border border-accent/40 bg-accent-soft p-4 text-sm text-body">
            Password updated. Taking you to your dashboard…
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label htmlFor="new-password" className={labelClass}>
                New password
              </label>
              <input
                id="new-password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className={labelClass}>
                Confirm password
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputClass}
              />
            </div>

            {error && <p className="text-sm text-clay">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-accent px-4 py-3 font-semibold text-paper shadow-[0_10px_22px_-10px_rgba(35,74,53,0.45)] transition hover:-translate-y-0.5 hover:bg-accent-bright disabled:transform-none disabled:opacity-40 disabled:shadow-none"
            >
              {loading ? "Saving…" : "Save new password"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
