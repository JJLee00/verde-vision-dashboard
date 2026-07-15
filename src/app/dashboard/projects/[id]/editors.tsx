"use client";

// Inline editors for the project record. Same save-on-blur + green-wash
// pattern as the Prices tab. All of these write to columns added in
// migration-009 (except status, which predates it) and are disabled
// until that migration has been run.

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const STATUSES = ["pending", "approved", "installed"] as const;

const STATUS_STYLES: Record<string, string> = {
  pending: "border-gold/40 bg-gold/10 text-gold",
  approved: "border-accent/40 bg-accent-soft text-accent-dim",
  installed: "border-clay/40 bg-clay/10 text-clay",
};

export function StatusSelect({
  projectId,
  initial,
  disabled,
}: {
  projectId: string;
  initial: string;
  disabled: boolean;
}) {
  const [status, setStatus] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function commit(next: string) {
    const prev = status;
    setStatus(next);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("projects")
      .update({ status: next })
      .eq("id", projectId);
    if (updateError) {
      setStatus(prev);
      setError("Could not update status.");
    }
  }

  return (
    <div className="text-right">
      <select
        value={status}
        disabled={disabled}
        onChange={(e) => commit(e.target.value)}
        aria-label="Project status"
        className={`cursor-pointer appearance-none rounded-full border px-4 py-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.14em] outline-none transition focus-visible:ring-2 focus-visible:ring-accent-soft disabled:cursor-default disabled:opacity-60 ${
          STATUS_STYLES[status] ?? "border-rule-strong bg-paper-deep text-muted"
        }`}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {error && <p className="mt-1.5 text-xs text-clay">{error}</p>}
    </div>
  );
}

function useFieldSave(projectId: string) {
  const [washField, setWashField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(column: string, value: string) {
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("projects")
      .update({ [column]: value.trim() || null })
      .eq("id", projectId);
    if (updateError) {
      setError("Could not save — try again.");
      return;
    }
    setWashField(column);
    setTimeout(() => setWashField((f) => (f === column ? null : f)), 1000);
  }

  return { washField, error, save };
}

const fieldClass = (washing: boolean) =>
  `w-full rounded-lg border border-rule bg-card-hover px-3 py-2 text-sm text-body outline-none transition placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-60 ${
    washing ? "save-wash" : ""
  }`;

export function DetailsForm({
  projectId,
  initialAddress,
  initialContactEmail,
  disabled,
}: {
  projectId: string;
  initialAddress: string | null;
  initialContactEmail: string | null;
  disabled: boolean;
}) {
  const [address, setAddress] = useState(initialAddress ?? "");
  const [email, setEmail] = useState(initialContactEmail ?? "");
  const [saved, setSaved] = useState({
    address: initialAddress ?? "",
    contact_email: initialContactEmail ?? "",
  });
  const { washField, error, save } = useFieldSave(projectId);

  async function commit(column: "address" | "contact_email", value: string) {
    if (value.trim() === saved[column].trim()) return;
    await save(column, value);
    setSaved((prev) => ({ ...prev, [column]: value }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label
          htmlFor="project-address"
          className="block text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-faint"
        >
          Address
        </label>
        <input
          id="project-address"
          type="text"
          value={address}
          disabled={disabled}
          placeholder="Street, city, state"
          onChange={(e) => setAddress(e.target.value)}
          onBlur={() => commit("address", address)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={`mt-1.5 ${fieldClass(washField === "address")}`}
        />
      </div>
      <div>
        <label
          htmlFor="project-contact"
          className="block text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-faint"
        >
          Homeowner email
        </label>
        <input
          id="project-contact"
          type="email"
          value={email}
          disabled={disabled}
          placeholder="name@example.com"
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => commit("contact_email", email)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={`mt-1.5 ${fieldClass(washField === "contact_email")}`}
        />
      </div>
      {error && <p className="text-xs text-clay">{error}</p>}
    </div>
  );
}

export function NotesEditor({
  projectId,
  initial,
  disabled,
}: {
  projectId: string;
  initial: string | null;
  disabled: boolean;
}) {
  const [notes, setNotes] = useState(initial ?? "");
  const [savedValue, setSavedValue] = useState(initial ?? "");
  const { washField, error, save } = useFieldSave(projectId);

  async function commit() {
    if (notes.trim() === savedValue.trim()) return;
    await save("notes", notes);
    setSavedValue(notes);
  }

  return (
    <div>
      <textarea
        value={notes}
        disabled={disabled}
        rows={6}
        placeholder="Gate code, dog's name, which hose bib works…"
        onChange={(e) => setNotes(e.target.value)}
        onBlur={commit}
        aria-label="Project notes"
        className={`${fieldClass(washField === "notes")} resize-y leading-relaxed`}
      />
      <p className="mt-1.5 text-[11px] text-faint">
        Saves when you click away. Not shown on client links.
      </p>
      {error && <p className="mt-1 text-xs text-clay">{error}</p>}
    </div>
  );
}
