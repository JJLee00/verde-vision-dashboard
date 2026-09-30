"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteProject, restoreProject } from "@/app/dashboard/actions";

/**
 * Removing a project, from the project page rather than from a card in the
 * list. You are looking at the thing you are about to delete — its estimate,
 * its blueprint, how much time went into it — and that context guards better
 * than any wording in a dialog.
 *
 * The confirmation says the two things that are actually at stake here and
 * nowhere else: it goes from every headset too, including work a headset has
 * not synced yet, and nothing is really destroyed, so an owner can put it
 * back. Same shape as the headset's own confirm, which names the project.
 */
export function DeleteProject({
  projectId,
  projectName,
  deleted,
}: {
  projectId: string;
  projectName: string;
  deleted: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    if (
      !confirm(
        `Delete "${projectName}"?\n\n` +
          `It disappears from the dashboard and from every headset the next ` +
          `time they sync — including any work a headset hasn't sent up yet.\n\n` +
          `The estimate, the blueprints and the design history are all kept, ` +
          `so an owner can restore it.`
      )
    )
      return;

    setError(null);
    startTransition(async () => {
      const result = await deleteProject(projectId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/dashboard");
    });
  }

  function restore() {
    setError(null);
    startTransition(async () => {
      const result = await restoreProject(projectId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (deleted) {
    return (
      <div className="mt-8 rounded-[14px] border border-gold/40 bg-gold/10 p-5">
        <p className="text-sm font-semibold text-gold">This project is deleted.</p>
        <p className="mt-1.5 text-sm text-muted">
          It is hidden from the project list and from every headset. Nothing has
          been thrown away — restoring it brings back the design, the estimate
          and the blueprints exactly as they were.
        </p>
        <button
          type="button"
          onClick={restore}
          disabled={pending}
          className="mt-4 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-paper transition hover:bg-accent-bright disabled:opacity-50"
        >
          {pending ? "Restoring…" : "Restore project"}
        </button>
        {error && <p className="mt-3 text-sm text-clay">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-6">
      <p className="text-sm text-muted">
        Deleting hides this project everywhere, including on the headsets. It
        can be restored.
      </p>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="rounded-lg border border-clay/40 px-4 py-2.5 text-sm font-semibold text-clay transition hover:bg-clay/10 disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete project"}
      </button>
      {error && <p className="w-full text-sm text-clay">{error}</p>}
    </div>
  );
}
