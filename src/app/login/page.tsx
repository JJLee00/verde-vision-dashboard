"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "forgot";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    // Always report success even if the email isn't on file — never reveal
    // which addresses have accounts.
    if (error && !/rate|limit/i.test(error.message)) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setSent(true);
    setLoading(false);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setSent(false);
    setPassword("");
  }

  const inputClass =
    "mt-2 w-full rounded-lg border border-edge bg-card-hover px-3.5 py-2.5 text-body outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft";
  const labelClass =
    "block text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted";

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-md rounded-[14px] border border-edge bg-card p-10 shadow-[0_18px_40px_-18px_rgba(28,42,33,0.25)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/verde-vision-logo.png"
          alt="Verde Vision logo"
          className="h-16 w-16 rounded-2xl border border-edge shadow-[0_8px_18px_-8px_rgba(28,42,33,0.4)]"
        />
        <p className="mt-6 text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-accent">
          Verde Vision
        </p>
        <h1 className="mt-3 font-serif text-3xl text-ink">
          {mode === "signin" ? "Client dashboard" : "Reset your password"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {mode === "signin"
            ? "Sign in to view your projects, estimates, and blueprints."
            : "Enter your email and we'll send you a link to set a new password."}
        </p>

        {mode === "signin" ? (
          <form onSubmit={handleSignIn} className="mt-9 space-y-5">
            <div>
              <label htmlFor="email" className={labelClass}>
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="password" className={labelClass}>
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => switchMode("forgot")}
                  className="text-xs font-semibold text-accent transition hover:text-accent-bright"
                >
                  Forgot password?
                </button>
              </div>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </div>

            {error && <p className="text-sm text-clay">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-accent px-4 py-3 font-semibold text-paper shadow-[0_10px_22px_-10px_rgba(35,74,53,0.45)] transition hover:-translate-y-0.5 hover:bg-accent-bright hover:shadow-[0_14px_28px_-10px_rgba(35,74,53,0.5)] disabled:transform-none disabled:opacity-40 disabled:shadow-none"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : sent ? (
          <div className="mt-9 space-y-5">
            <div className="rounded-lg border border-accent/40 bg-accent-soft p-4 text-sm text-body">
              If an account exists for <span className="font-semibold">{email}</span>,
              a password-reset link is on its way. Check your inbox (and spam)
              and follow the link to set a new password.
            </div>
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="text-sm font-semibold text-accent transition hover:text-accent-bright"
            >
              ← Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleForgot} className="mt-9 space-y-5">
            <div>
              <label htmlFor="reset-email" className={labelClass}>
                Email
              </label>
              <input
                id="reset-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>

            {error && <p className="text-sm text-clay">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-accent px-4 py-3 font-semibold text-paper shadow-[0_10px_22px_-10px_rgba(35,74,53,0.45)] transition hover:-translate-y-0.5 hover:bg-accent-bright hover:shadow-[0_14px_28px_-10px_rgba(35,74,53,0.5)] disabled:transform-none disabled:opacity-40 disabled:shadow-none"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="text-sm font-semibold text-accent transition hover:text-accent-bright"
            >
              ← Back to sign in
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
