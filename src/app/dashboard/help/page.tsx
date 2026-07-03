export default function HelpPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-clay">
        Help
      </p>
      <h1 className="mt-2 font-serif text-4xl text-ink">
        Questions about your project?
      </h1>

      <section className="mt-8 max-w-xl rounded-[14px] border border-edge bg-card p-7 shadow-[0_18px_40px_-24px_rgba(28,42,33,0.35)]">
        <p className="text-sm leading-relaxed text-body">
          Your Verde Vision designer is your best point of contact for
          anything on this dashboard — estimates, blueprints, plant lists, or
          changes to your design. Reach out to them directly and they&rsquo;ll
          get you sorted.
        </p>
        <p className="mt-5 border-t border-rule pt-5 text-sm text-muted">
          Learn more about Verde Vision at{" "}
          <a
            href="https://useverdevision.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-accent underline decoration-accent-soft underline-offset-4 transition hover:text-accent-bright"
          >
            useverdevision.com
          </a>
          .
        </p>
      </section>
    </div>
  );
}
