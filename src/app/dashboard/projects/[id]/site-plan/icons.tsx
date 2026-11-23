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

export function TurnIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...icon(size)}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}

export function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...icon(size)}>
      <circle cx={11} cy={11} r={6.5} />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  );
}

export function CursorIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...icon(size)}>
      <path d="M6 3.5l12 7.2-5.3 1.3-2.6 5.5z" />
      <path d="M12.7 12l4.3 5" />
    </svg>
  );
}

export function PlusIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...icon(size)}>
      <circle cx={12} cy={12} r={8.5} />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

export function RulerIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...icon(size)}>
      <path d="M3.5 15.5l12-12 5 5-12 12z" />
      <path d="M7.5 11.5l2 2M10.5 8.5l1.5 1.5M13.5 5.5l2 2" />
    </svg>
  );
}

export function SizeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...icon(size)}>
      <path d="M8 7l4-4 4 4" />
      <path d="M8 17l4 4 4-4" />
      <path d="M12 3v18" />
    </svg>
  );
}

export function SwapIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...icon(size)}>
      <path d="M4 8h13l-3-3" />
      <path d="M20 16H7l3 3" />
    </svg>
  );
}

export function BackIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...icon(size)}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function CheckIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...icon(size)}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

export function UploadIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...icon(size)}>
      <path d="M12 15V4" />
      <path d="M7.5 8.5L12 4l4.5 4.5" />
      <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}

/** The yard from above: a lot, a house and a tree, framed. */
export function AerialIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...icon(size)}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <rect x="7" y="7.5" width="6.5" height="5.5" />
      <circle cx="16" cy="16" r="2.2" />
      <path d="M3.5 16.5h7.5" strokeDasharray="1.5 2" />
    </svg>
  );
}
