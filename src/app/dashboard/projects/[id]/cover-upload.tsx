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
  /** "overlay" sits on top of the photo it replaces, on a project card. */
  variant?: "link" | "overlay";
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

  const buttonClass =
    variant === "overlay"
      ? "rounded-lg border border-edge bg-paper/90 px-2.5 py-1.5 text-xs font-semibold text-body shadow-[0_8px_20px_-12px_rgba(28,42,33,0.5)] backdrop-blur-sm transition hover:bg-paper disabled:opacity-50"
      : "text-xs font-semibold text-accent transition hover:text-accent-bright disabled:opacity-50";

  return (
    <div className={variant === "overlay" ? "" : "text-right"}>
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
        className={buttonClass}
      >
        {busy
          ? "Uploading…"
          : hasCover
            ? variant === "overlay"
              ? "Replace photo"
              : "Replace cover photo"
            : variant === "overlay"
              ? "Add photo"
              : "Add cover photo"}
      </button>
      {error && <p className="mt-1 text-xs text-clay">{error}</p>}
    </div>
  );
}
