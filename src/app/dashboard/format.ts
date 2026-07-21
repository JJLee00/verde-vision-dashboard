// Shared, server-safe formatters for the dashboard. Kept out of the
// "use client" donut module so server components (e.g. team-performance)
// can call them directly — a function exported from a client module is a
// client reference and can't be invoked during server render.

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
