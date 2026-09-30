"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createProject, updateProjectDetails } from "./actions";

const FIELD =
  "w-full rounded-lg border border-edge bg-card px-3.5 py-2.5 text-sm text-body outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft";
const LABEL =
  "text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-faint";

export type ProjectDetails = {
  name: string;
  customerName: string;
  address: string;
  contactEmail: string;
};

const EMPTY: ProjectDetails = {
  name: "",
  customerName: "",
  address: "",
  contactEmail: "",
};

/**
 * The one form a project's details are ever entered in.
 *
 * Creating and editing ask for exactly the same four things, so they are the
 * same dialog in two modes rather than two forms that drift apart. None of it
 * is typed in the headset on purpose: entering an address on a virtual
 * keyboard while standing in someone's driveway is miserable, and this is
 * precisely the work that belongs at a desk.
 */
function ProjectDialog({
  title,
  intro,
  submitLabel,
  busyLabel,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  intro: string;
  submitLabel: string;
  busyLabel: string;
  initial: ProjectDetails;
  onClose: () => void;
  onSubmit: (
    details: ProjectDetails
  ) => Promise<{ ok: true; id?: string } | { ok: false; error: string }>;
}) {
  const router = useRouter();
  const [details, setDetails] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof ProjectDetails) => (value: string) =>
    setDetails((d) => ({ ...d, [key]: value }));

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await onSubmit(details);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
      if (result.id) router.push(`/dashboard/projects/${result.id}`);
      else router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-[14px] border border-edge bg-paper p-6 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
        <h2 className="font-serif text-xl text-ink">{title}</h2>
        <p className="mt-1.5 text-sm text-muted">{intro}</p>

        <div className="mt-5 space-y-4">
          <Field
            label="Project name"
            autoFocus
            value={details.name}
            onChange={set("name")}
            onEnter={() => details.name.trim() && !pending && submit()}
            placeholder="e.g. Hartley — front yard"
          />
          <Field
            label="Customer name"
            value={details.customerName}
            onChange={(v) =>
              setDetails((d) => ({
                ...d,
                customerName: v,
                // Most projects are named after the customer, so the project
                // name follows along until someone types their own. Only
                // while it is still tracking — an edited name is never
                // overwritten.
                name: d.name === d.customerName ? v : d.name,
              }))
            }
            placeholder="e.g. Dani Hartley"
          />
          <Field
            label="Address"
            value={details.address}
            onChange={set("address")}
            placeholder="Street, city, state"
            hint="Used on site to pull the lot and house outline."
          />
          <Field
            label="Customer email"
            type="email"
            value={details.contactEmail}
            onChange={set("contactEmail")}
            placeholder="name@example.com"
          />
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-clay/40 bg-clay/10 px-3.5 py-2.5 text-sm text-clay">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-edge px-4 py-2.5 text-sm font-semibold text-body transition hover:bg-paper-deep disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !details.name.trim()}
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-paper transition hover:bg-accent-bright disabled:opacity-50"
          >
            {pending ? busyLabel : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
  autoFocus = false,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  type?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <input
        autoFocus={autoFocus}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) onEnter();
        }}
        placeholder={placeholder}
        className={`mt-1.5 ${FIELD}`}
      />
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export function NewProjectButton() {
  const [open, setOpen] = useState(false);
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
        <ProjectDialog
          title="New project"
          intro="It starts as a draft with no design. Open it in the headset to walk the yard."
          submitLabel="Create project"
          busyLabel="Creating…"
          initial={EMPTY}
          onClose={() => setOpen(false)}
          onSubmit={createProject}
        />
      )}
    </>
  );
}

export function EditProjectButton({
  projectId,
  initial,
}: {
  projectId: string;
  initial: ProjectDetails;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-edge px-3.5 py-2 text-sm font-semibold text-body transition hover:bg-paper-deep"
      >
        Edit details
      </button>
      {open && (
        <ProjectDialog
          title="Project details"
          intro="The same four things the project was created with."
          submitLabel="Save"
          busyLabel="Saving…"
          initial={initial}
          onClose={() => setOpen(false)}
          onSubmit={(details) => updateProjectDetails(projectId, details)}
        />
      )}
    </>
  );
}
