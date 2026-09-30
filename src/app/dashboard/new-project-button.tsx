"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createProject } from "./actions";

const FIELD =
  "w-full rounded-lg border border-edge bg-card px-3.5 py-2.5 text-sm text-body outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft";

/**
 * Starting a project from the office.
 *
 * Until now only the headset could bring one into existence, so planning a
 * job meant going out to the yard first. A project created here has no
 * design — it's a name and a date waiting for someone to walk it — and the
 * headset picks it up from the project list.
 */
export function NewProjectButton({
  designers,
}: {
  /** Owners can start a project for anyone on the team; a designer gets
   *  their own name only, so the picker is hidden for them. */
  designers: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [projectDate, setProjectDate] = useState("");
  const [designerId, setDesignerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createProject({
        name,
        projectDate: projectDate || null,
        designerId: designerId || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setName("");
      setProjectDate("");
      // Straight into the project rather than back to the list: the next
      // thing anyone does with a new project is fill it in.
      if (result.id) router.push(`/dashboard/projects/${result.id}`);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-paper transition hover:bg-accent-bright"
      >
        + New project
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="New project"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-[14px] border border-edge bg-paper p-6 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
            <h2 className="font-serif text-xl text-ink">New project</h2>
            <p className="mt-1.5 text-sm text-muted">
              It starts as a draft with no design. Open it in the headset to
              walk the yard.
            </p>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-faint">
                  Project name
                </span>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && name.trim() && !pending) submit();
                  }}
                  placeholder="e.g. Hartley — front yard"
                  className={`mt-1.5 ${FIELD}`}
                />
              </label>

              <label className="block">
                <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-faint">
                  Date <span className="normal-case tracking-normal">(optional)</span>
                </span>
                <input
                  type="date"
                  value={projectDate}
                  onChange={(e) => setProjectDate(e.target.value)}
                  className={`mt-1.5 ${FIELD}`}
                />
              </label>

              {designers.length > 1 && (
                <label className="block">
                  <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-faint">
                    Designer
                  </span>
                  <select
                    value={designerId}
                    onChange={(e) => setDesignerId(e.target.value)}
                    className={`mt-1.5 appearance-none ${FIELD}`}
                  >
                    {designers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {error && (
              <p className="mt-4 rounded-lg border border-clay/40 bg-clay/10 px-3.5 py-2.5 text-sm text-clay">
                {error}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-lg border border-edge px-4 py-2.5 text-sm font-semibold text-body transition hover:bg-paper-deep disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending || !name.trim()}
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-paper transition hover:bg-accent-bright disabled:opacity-50"
              >
                {pending ? "Creating…" : "Create project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
