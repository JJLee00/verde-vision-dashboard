// The builder's few icons, drawn in the dashboard's line weight. Each takes
// the text colour, so a button's hover and state colour it.

const icon = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export function UndoIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...icon(size)}>
      <path d="M9 14l-4-4 4-4" />
      <path d="M5 10h11a4 4 0 1 1 0 8h-1" />
    </svg>
  );
}

export function RedoIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...icon(size)}>
      <path d="M15 14l4-4-4-4" />
      <path d="M19 10H8a4 4 0 1 0 0 8h1" />
    </svg>
  );
}

export function LockIcon({ open = false, size = 18 }: { open?: boolean; size?: number }) {
  return (
    <svg {...icon(size)}>
      <rect x={5} y={11} width={14} height={10} rx={2} />
      <path d={open ? "M8 11V6a4 4 0 0 1 8 0" : "M8 11V7a4 4 0 1 1 8 0v4"} />
    </svg>
  );
}

/** A curve through three corners. */
export function CurveIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...icon(size)}>
      <path d="M4 18C6 9 10 6 12 6s6 3 8 12" />
      <circle cx={4} cy={18} r={1.4} fill="currentColor" />
      <circle cx={12} cy={6} r={1.4} fill="currentColor" />
      <circle cx={20} cy={18} r={1.4} fill="currentColor" />
    </svg>
  );
}

export function CopyIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...icon(size)}>
      <rect x={8} y={8} width={12} height={12} rx={2} />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

export function TrashIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...icon(size)}>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </svg>
  );
}
