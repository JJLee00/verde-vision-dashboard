"use client";

// Cover photo upload — stored in the private project-media bucket under
// {user_id}/{project_id}/, path recorded on projects.cover_path. The
// page re-renders with a fresh signed URL after upload.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export function CoverUpload({
  projectId,
  userId,
  hasCover,
  disabled,
  variant = "link",
}: {
  projectId: string;
  userId: string;
  hasCover: boolean;
  disabled: boolean;
  /**
   * "plus" fills the card's photo slot: a single + when there is no photo,
   * and — once there is one — a target that stays invisible until the
   * pointer is over the slot, so the photo is not permanently wearing a
   * button.
   */
  variant?: "link" | "plus";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function upload(file: File) {
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image is over 20 MB.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${userId}/${projectId}/cover-${Date.now()}.${ext}`;
    try {
      const { error: uploadError } = await supabase.storage
        .from("project-media")
        .upload(path, file, { contentType: file.type });
      if (uploadError) throw new Error(uploadError.message);
      // cover_updated_at is what lets the headset — which keeps its covers
      // as plain files — work out whether this one is newer than the one it
      // already has. Without the stamp the photo still appears on a headset
      // that has no cover, and is never allowed to replace one.
      const stamped = { cover_path: path, cover_updated_at: new Date().toISOString() };
      let { error: updateError } = await supabase
        .from("projects")
        .update(stamped)
        .eq("id", projectId);
      if (updateError && /cover_updated_at/.test(updateError.message)) {
        // Pre-021. The cover itself still belongs on the project.
        ({ error: updateError } = await supabase
          .from("projects")
          .update({ cover_path: path })
          .eq("id", projectId));
      }
      if (updateError) throw new Error(updateError.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  if (variant === "plus") {
    return (
      <>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = "";
          }}
        />

        {hasCover ? (
          // Out of the way until the pointer is on the card. The label
          // lives in the tooltip and the accessible name, so the photo is
          // not carrying a line of interface text on top of it.
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
            aria-label="Replace cover photo"
            title="Replace cover photo"
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-paper/40 bg-ink/45 text-paper opacity-0 backdrop-blur-sm transition hover:bg-ink/70 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
          >
            {busy ? (
              <span className="text-[0.65rem] font-semibold">…</span>
            ) : (
              <svg
                aria-hidden
                className="h-[18px] w-[18px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2L9 5h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" />
                <circle cx="12" cy="13" r="3.2" />
              </svg>
            )}
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
            className="group/slot absolute inset-0 flex flex-col items-center justify-center gap-2.5 transition hover:bg-ink/[0.03] disabled:opacity-50"
          >
            <svg
              aria-hidden
              className="h-8 w-8 text-faint transition group-hover/slot:text-accent"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="5" width="18" height="15" rx="2" />
              <circle cx="9" cy="10" r="1.6" />
              <path d="m5 19 5.2-5.2a1.5 1.5 0 0 1 2.1 0L17 18.5m-2.5-2.5 1.8-1.8a1.5 1.5 0 0 1 2.1 0L21 16.5" />
            </svg>
            <span className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint transition group-hover/slot:text-accent">
              {busy ? "Uploading…" : "Add cover photo"}
            </span>
          </button>
        )}

        {error && (
          <p className="absolute inset-x-3 bottom-3 rounded bg-paper/95 px-2 py-1 text-center text-xs text-clay">
            {error}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="text-right">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        className="text-xs font-semibold text-accent transition hover:text-accent-bright disabled:opacity-50"
      >
        {busy ? "Uploading…" : hasCover ? "Replace cover photo" : "Add cover photo"}
      </button>
      {error && <p className="mt-1 text-xs text-clay">{error}</p>}
    </div>
  );
}
