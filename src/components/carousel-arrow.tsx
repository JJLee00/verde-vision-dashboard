"use client";

/**
 * The previous/next control, shared by the client page's walkthrough tile and
 * the project page's video manager — two places showing the same videos, so
 * they should not drift into looking like two different controls.
 */
export function CarouselArrow({
  side,
  onClick,
  label,
}: {
  side: "left" | "right";
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      // Vertically centred, which keeps it clear of the player's scrubber.
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
