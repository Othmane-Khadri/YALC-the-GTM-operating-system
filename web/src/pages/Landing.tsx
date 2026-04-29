// Minimal landing surface for the SPA bootstrap. The legacy static-HTML
// dashboards (/campaigns, /review, /frameworks, /monthly-report) are
// still served by the Hono server during the migration window — links
// here drop users into them directly.
export function Landing() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <section className="max-w-xl text-center">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground mb-4">
          GTM operating system
        </p>
        <h1 className="font-heading text-6xl font-bold tracking-tight mb-4">
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          >
            YALC
          </span>
        </h1>
        <p className="text-base text-muted-foreground mb-10">
          Open-source, AI-native GTM engine. Lead finding, enrichment, qualification, and campaign
          orchestration — all driven from one CLI.
        </p>
        <nav className="grid grid-cols-2 gap-3 text-left">
          <a
            href="/campaigns"
            className="rounded-lg border border-border bg-card p-4 shadow-sm hover:shadow-md transition"
          >
            <div className="font-heading font-semibold">Campaigns</div>
            <div className="text-sm text-muted-foreground">LinkedIn outreach dashboard</div>
          </a>
          <a
            href="/review"
            className="rounded-lg border border-border bg-card p-4 shadow-sm hover:shadow-md transition"
          >
            <div className="font-heading font-semibold">Review</div>
            <div className="text-sm text-muted-foreground">Lead qualification queue</div>
          </a>
          <a
            href="/frameworks"
            className="rounded-lg border border-border bg-card p-4 shadow-sm hover:shadow-md transition"
          >
            <div className="font-heading font-semibold">Frameworks</div>
            <div className="text-sm text-muted-foreground">Installed framework runs</div>
          </a>
          <a
            href="/brand"
            className="rounded-lg border border-border bg-card p-4 shadow-sm hover:shadow-md transition"
          >
            <div className="font-heading font-semibold">Brand kit</div>
            <div className="text-sm text-muted-foreground">Tokens, colors, type</div>
          </a>
        </nav>
      </section>
    </main>
  )
}
