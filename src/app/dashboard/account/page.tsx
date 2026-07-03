import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const longDate = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export default async function AccountPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-clay">
        Account
      </p>
      <h1 className="mt-2 font-serif text-4xl text-ink">Your account</h1>

      <section className="mt-8 max-w-xl rounded-[14px] border border-edge bg-card p-7 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
        <dl className="space-y-5">
          <div>
            <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
              Email
            </dt>
            <dd className="mt-1.5 text-sm text-body">{user.email}</dd>
          </div>
          <div>
            <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
              Member since
            </dt>
            <dd className="mt-1.5 text-sm text-body">
              {longDate.format(new Date(user.created_at))}
            </dd>
          </div>
        </dl>
        <p className="mt-6 border-t border-rule pt-5 text-sm text-muted">
          To update your email or password, contact your Verde Vision
          designer.
        </p>
      </section>
    </div>
  );
}
