"use client";

import { useState } from "react";

/**
 * One video at a time, with arrows.
 *
 * Stacked videos made the tile's height depend on how many were uploaded,
 * which is what stopped the grid being able to line up at all. A carousel is
 * one fixed size whatever the count — the layout reason, not just the tidier
 * one.
 *
 * With a single video the controls disappear: chrome for a control that
 * cannot do anything is worse than no chrome.
 */
export function VideoCarousel({ videos }: { videos: string[] }) {
  const [index, setIndex] = useState(0);
  const many = videos.length > 1;
  const go = (delta: number) =>
    setIndex((i) => (i + delta + videos.length) % videos.length);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
          Walkthrough
        </p>
        {many && (
          <span className="text-[0.68rem] font-semibold text-faint">
            {index + 1} of {videos.length}
          </span>
        )}
      </div>

      <div className="relative mt-2.5 min-h-0 flex-1">
        <video
          // Keyed so switching swaps the element rather than re-pointing a
          // playing one, which leaves the previous video's frame on screen
          // until the new source loads.
          key={videos[index]}
          src={videos[index]}
          controls
          preload="metadata"
          playsInline
          className="absolute inset-0 h-full w-full rounded-[10px] border border-rule bg-ink/[0.05] object-contain"
        />
        {many && (
          <>
            <Arrow side="left" onClick={() => go(-1)} />
            <Arrow side="right" onClick={() => go(1)} />
          </>
        )}
      </div>
    </div>
  );
}

function Arrow({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous video" : "Next video"}
      // Clear of the bottom so it never sits over the scrubber.
      className={`absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-paper/40 bg-ink/50 text-paper backdrop-blur-sm transition hover:bg-ink/75 ${
        side === "left" ? "left-2" : "right-2"
      }`}
    >
      <span aria-hidden className="text-lg leading-none">
        {side === "left" ? "‹" : "›"}
      </span>
    </button>
  );
}
