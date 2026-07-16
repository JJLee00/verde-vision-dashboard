"use client";

// Walkthrough videos — visionOS screen recordings land in the designer's
// Photos app, not the headset app's sandbox, so they get here by manual
// upload. Stored under {user_id}/{project_id}/videos/ in project-media.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type VideoItem = { path: string; name: string; url: string };

const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

export function VideoManager({
  projectId,
  userId,
  videos,
  disabled,
}: {
  projectId: string;
  userId: string;
  videos: VideoItem[];
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function upload(file: File) {
    if (file.size > MAX_VIDEO_BYTES) {
      setError("Video is over 300 MB — trim or compress it first.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
    const path = `${userId}/${projectId}/videos/${Date.now()}-${safeName}`;
    try {
      const { error: uploadError } = await supabase.storage
        .from("project-media")
        .upload(path, file, { contentType: file.type });
      if (uploadError) throw new Error(uploadError.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(path: string) {
    if (!confirm("Remove this walkthrough video?")) return;
    setError(null);
    const supabase = createClient();
    const { error: removeError } = await supabase.storage
      .from("project-media")
      .remove([path]);
    if (removeError) {
      setError("Could not remove the video.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {videos.length === 0 && (
        <p className="text-sm text-muted">
          Record a walkthrough on the headset (passthrough included), then
          upload it here to share with the homeowner later.
        </p>
      )}
      {videos.map((v) => (
        <div key={v.path}>
          <video
            src={v.url}
            controls
            preload="metadata"
            className="w-full rounded-[10px] border border-edge bg-ink/5"
          />
          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="truncate text-[11px] text-faint">{v.name}</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(v.path)}
                className="shrink-0 text-[11px] font-semibold text-clay transition hover:opacity-75"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      ))}
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
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
        className="rounded-lg border border-rule-strong px-3.5 py-2 text-sm font-semibold text-ink transition hover:bg-card-hover disabled:opacity-50"
      >
        {busy ? "Uploading…" : "Upload video"}
      </button>
      {error && <p className="text-xs text-clay">{error}</p>}
    </div>
  );
}
