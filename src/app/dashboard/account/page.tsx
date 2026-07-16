import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership, getOrgMembers, memberName } from "@/lib/org";
import { InviteDesignerForm, RemoveDesignerButton } from "./team";

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

  // Team section appears only once migration-011 has run (teamEnabled).
  const membership = await getMembership(supabase, user.id);
  const members =
    membership?.teamEnabled
      ? await getOrgMembers(supabase, membership.orgId)
      : [];
  const designerCount = members.filter((m) => m.role === "designer").length;
  const seatsLeft = membership
    ? Math.max(membership.maxDesigners - designerCount, 0)
    : 0;
  const isOwner = membership?.role === "owner";

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

      {membership?.teamEnabled && (
        <section className="mt-8 max-w-xl rounded-[14px] border border-edge bg-card p-7 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-faint">
              Team{membership.orgName ? ` — ${membership.orgName}` : ""}
            </h2>
            <p className="text-xs text-muted">
              {designerCount} of {membership.maxDesigners} designer seats used
            </p>
          </div>

          <ul className="mt-4 divide-y divide-rule">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">
                    {memberName(m)}
                    {m.user_id === user.id && (
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
                  <RemoveDesignerButton
                    userId={m.user_id}
                    name={memberName(m)}
                  />
                )}
              </li>
            ))}
          </ul>

          {isOwner ? (
            <InviteDesignerForm seatsLeft={seatsLeft} />
          ) : (
            <p className="mt-5 border-t border-rule pt-5 text-sm text-muted">
              Your account owner manages the team.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
