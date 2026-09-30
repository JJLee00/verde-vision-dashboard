"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { SiteMarker } from "@/lib/markers";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * The three plates a site runs on, and the photos that let someone find them
 * again months later.
 *
 * Photos can be added here because the headset cannot take them. visionOS
 * main camera access is an enterprise entitlement, so the app offers a photo
 * PICKER — the designer has to have already screenshotted the plate or shot
 * it on their phone, then find it in the library while standing in a
 * driveway. Doing it later, at a desk, with a mouse, is simply better.
 */
export function SiteMarkers({
  projectId,
  mediaOwnerId,
  markers,
  disabled,
}: {
  projectId: string;
  mediaOwnerId: string;
  markers: SiteMarker[];
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
      {markers.map((marker) => (
        <MarkerColumn
          key={marker.step}
          projectId={projectId}
          mediaOwnerId={mediaOwnerId}
          marker={marker}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function MarkerColumn({
  projectId,
  mediaOwnerId,
  marker,
  disabled,
}: {
  projectId: string;
  mediaOwnerId: string;
  marker: SiteMarker;
  disabled: boolean;
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
    // The SAME stable path the headset upserts to, so a photo added here and
    // one synced from the yard are the same object — last one wins, and
    // neither has to know about the other.
    const path = `${mediaOwnerId}/${projectId}/anchors/${marker.step}.jpg`;
    try {
      const { error: uploadError } = await supabase.storage
        .from("project-media")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (uploadError) throw new Error(uploadError.message);

      // anchor_paths is a map keyed by step; merge rather than replace so
      // uploading one photo does not forget the other two.
      const { data: current } = await supabase
        .from("projects")
        .select("anchor_paths")
        .eq("id", projectId)
        .maybeSingle();
      const merged = {
        ...((current?.anchor_paths as Record<string, string> | null) ?? {}),
        [marker.step]: path,
      };
      const { error: updateError } = await supabase
        .from("projects")
        .update({ anchor_paths: merged })
        .eq("id", projectId);
      if (updateError) throw new Error(updateError.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="group relative aspect-[4/3] w-full overflow-hidden rounded-[10px] border border-rule bg-ink/[0.05]">
        {marker.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={marker.photoUrl}
            alt={`${marker.plateLabel} reference photo`}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
        {!disabled && (
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            aria-label={`${marker.photoUrl ? "Replace" : "Add"} photo for ${marker.plateLabel}`}
            title={`${marker.photoUrl ? "Replace" : "Add"} photo`}
            className={
              marker.photoUrl
                ? "absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border border-paper/40 bg-ink/45 text-paper opacity-0 backdrop-blur-sm transition hover:bg-ink/70 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                : "absolute inset-0 flex flex-col items-center justify-center gap-2 transition hover:bg-ink/[0.03] disabled:opacity-50"
            }
          >
            {busy ? (
              <span className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted">
                Uploading…
              </span>
            ) : (
              <>
                <CameraIcon
                  className={
                    marker.photoUrl
                      ? "h-4 w-4"
                      : "h-7 w-7 text-faint transition group-hover:text-accent"
                  }
                />
                {!marker.photoUrl && (
                  <span className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-faint transition group-hover:text-accent">
                    Add photo
                  </span>
                )}
              </>
            )}
          </button>
        )}
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
      </div>

      <p className="mt-2.5 font-serif text-lg text-ink">{marker.plateLabel}</p>

      {/* Locked is the headset having seen this plate and written its
          position into the project's permanent frame — not that a photo of
          it exists. "On site" earns its words: the photo directly above can
          be added from a desk and the lock cannot, which is the one thing
          about this card somebody is likely to get wrong.

          Grey rather than red when it hasn't happened: a project nobody has
          been out to yet is in the correct state, not a broken one, and the
          card cannot tell that apart from one that is overdue. */}
      <p
        className={`mt-0.5 flex items-center gap-1.5 text-sm ${
          marker.locked ? "text-accent" : "text-faint"
        }`}
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            marker.locked ? "bg-accent" : "bg-rule-strong"
          }`}
        />
        {marker.locked ? "Locked" : "Not locked on site yet"}
        {marker.locked && marker.lockedDate && (
          <span className="text-faint">
            ·{" "}
            {new Date(marker.lockedDate).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
      </p>

      {marker.note && (
        <p className="mt-1 text-sm text-muted">{marker.note}</p>
      )}
      {error && <p className="mt-1 text-xs text-clay">{error}</p>}
    </div>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
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
  );
}
