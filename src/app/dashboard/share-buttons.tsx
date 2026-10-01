"use client";

import { useState } from "react";

/**
 * Copy-to-clipboard for a project's public link (see /share/[token]).
 *
 * ONE link now. There used to be two — a client link with pricing and a crew
 * link without — and pricing was the only difference between them. The
 * viewer no longer shows any, so the distinction had nothing left to carry.
 * The crew token still resolves, so links already sent keep working; the
 * dashboard simply stops offering a second one to copy.
 *
 * Rendered on the project card (compact) and the project page header (full).
 * Sharing is a management action, so it lives with the project record rather
 * than inside the viewer.
 */
export function ShareLinkButtons({
  clientToken,
  compact = false,
}: {
  clientToken: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(
      `${location.origin}/share/${clientToken}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={copy}
        className="font-semibold text-accent underline decoration-accent-soft underline-offset-4 transition hover:text-accent-bright"
      >
        {copied ? "Copied ✓" : "Client link"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="A page with the design, the plan and any walkthrough videos"
      className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-paper transition hover:bg-accent-bright"
    >
      {copied ? "Copied ✓" : "Copy client link"}
    </button>
  );
}
