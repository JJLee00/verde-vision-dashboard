"use client";

import { useState } from "react";
import { CarouselArrow } from "@/components/carousel-arrow";

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
            <CarouselArrow side="left" label="Previous video" onClick={() => go(-1)} />
            <CarouselArrow side="right" label="Next video" onClick={() => go(1)} />
          </>
        )}
      </div>
    </div>
  );
}
