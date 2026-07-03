export default function PlantLibraryPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-clay">
        Plant Library
      </p>
      <h1 className="mt-2 font-serif text-4xl text-ink">Plant library</h1>

      <section className="mt-8 flex max-w-xl flex-col items-center rounded-[14px] border border-edge bg-card px-7 py-12 text-center shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
        <svg
          className="h-12 w-12 text-accent/40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 21c0-8.5 3.5-14.5 14-16-.5 10.5-6.5 14.5-14 16Zm0 0c2.5-6 6-10 11-12.5" />
        </svg>
        <h2 className="mt-4 font-serif text-xl text-ink">Coming soon</h2>
        <p className="mt-2 text-sm text-muted">
          Soon you&rsquo;ll be able to browse every plant in your design here,
          with photos, mature sizes, and care notes.
        </p>
      </section>
    </div>
  );
}
