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
      const { error: updateError } = await supabase
        .from("projects")
        .update({ cover_path: path })
        .eq("id", projectId);
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
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          aria-label={hasCover ? "Replace cover photo" : "Add cover photo"}
          title={hasCover ? "Replace cover photo" : "Add cover photo"}
          className={
            // With a photo the control sits in a corner and only appears on
            // hover, so it never covers the image or steals a click meant
            // for the card's link. With no photo it IS the slot.
            hasCover
              ? "absolute right-2.5 top-2.5 flex h-9 w-9 items-center justify-center rounded-full border border-edge bg-paper/90 text-lg text-body opacity-0 shadow-[0_8px_20px_-12px_rgba(28,42,33,0.5)] backdrop-blur-sm transition hover:bg-paper focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
              : "absolute inset-0 flex items-center justify-center text-3xl font-light text-faint transition hover:bg-ink/[0.03] hover:text-accent disabled:opacity-50"
          }
        >
          {busy ? (
            <span className="text-xs font-semibold tracking-wide">…</span>
          ) : (
            <span aria-hidden className="leading-none">+</span>
          )}
        </button>
        {error && (
          <p className="absolute inset-x-2 bottom-2 rounded bg-paper/95 px-2 py-1 text-center text-xs text-clay">
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
