"use client";

import { useState } from "react";

// Copy-to-clipboard buttons for a project's public share links (see
// /share/[token]): the client link shows pricing, the crew link is the
// same viewer with prices hidden. Rendered on the project card (compact)
// and the project page header (full) — sharing is a management action,
// so it lives with the project record, not inside the viewer.
export function ShareLinkButtons({
  clientToken,
  crewToken,
  compact = false,
}: {
  clientToken: string;
  crewToken: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState<"client" | "crew" | null>(null);

  const copy = async (kind: "client" | "crew") => {
    const token = kind === "client" ? clientToken : crewToken;
    await navigator.clipboard.writeText(`${location.origin}/share/${token}`);
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
  };

  if (compact) {
    const link =
      "font-semibold text-accent underline decoration-accent-soft underline-offset-4 transition hover:text-accent-bright";
    return (
      <span className="flex items-center gap-2.5">
        <button type="button" onClick={() => copy("client")} className={link}>
          {copied === "client" ? "Copied ✓" : "Client link"}
        </button>
        <button
          type="button"
          onClick={() => copy("crew")}
          title="Same viewer without pricing — for install crews"
          className={link}
        >
          {copied === "crew" ? "Copied ✓" : "Crew"}
        </button>
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => copy("client")}
        className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-paper transition hover:bg-accent-bright"
      >
        {copied === "client" ? "Copied ✓" : "Copy client link"}
      </button>
      <button
        type="button"
        onClick={() => copy("crew")}
        title="Same viewer without pricing — for install crews"
        className="rounded-lg border border-rule-strong px-3 py-1.5 text-[13px] font-semibold text-ink transition hover:bg-card"
      >
        {copied === "crew" ? "Copied ✓" : "Crew link"}
      </button>
    </div>
  );
}
