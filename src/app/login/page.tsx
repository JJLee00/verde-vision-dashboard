"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
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

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-md rounded-[14px] border border-edge bg-card p-10 shadow-[0_18px_40px_-18px_rgba(28,42,33,0.25)]">
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-accent">
          Verde Vision
        </p>
        <h1 className="mt-3 font-serif text-3xl text-ink">
          Client dashboard
        </h1>
        <p className="mt-2 text-sm text-muted">
          Sign in to view your projects, estimates, and blueprints.
        </p>

        <form onSubmit={handleSubmit} className="mt-9 space-y-5">
          <div>
            <label
              htmlFor="email"
              className="block text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-lg border border-edge bg-card-hover px-3.5 py-2.5 text-body outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 w-full rounded-lg border border-edge bg-card-hover px-3.5 py-2.5 text-body outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
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
      </div>
    </main>
  );
}
