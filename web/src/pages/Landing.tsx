/**
 * Landing — the SPA's index page.
 *
 * The four primary daily-use views (/today, /brain, /keys, /skills) sit
 * at the top. The legacy static-HTML dashboards (/campaigns, /review,
 * /monthly-report, /frameworks) still ship in 0.9.0 so existing scripts
 * keep working, but they're labelled as such and slated for retirement
 * in 1.0.0.
 */
const PRIMARY: Array<{ href: string; title: string; subtitle: string }> = [
  { href: '/today', title: 'Today', subtitle: 'Latest framework runs and pending gates' },
  { href: '/brain', title: 'Brain', subtitle: 'Live company context, voice, and ICP' },
  { href: '/keys', title: 'Keys', subtitle: 'Provider status and health probes' },
  { href: '/skills', title: 'Skills', subtitle: 'Skill catalog and inline runner' },
]

const LEGACY: Array<{ href: string; title: string; subtitle: string }> = [
  { href: '/campaigns', title: 'Campaigns', subtitle: 'LinkedIn outreach dashboard' },
  { href: '/review', title: 'Review', subtitle: 'Lead qualification queue' },
  { href: '/frameworks', title: 'Frameworks', subtitle: 'Installed framework runs' },
  { href: '/monthly-report', title: 'Monthly report', subtitle: 'Cross-campaign rollup' },
  { href: '/brand', title: 'Brand kit', subtitle: 'Tokens, colors, type' },
]

export function Landing() {
  return (
    <main className="min-h-screen px-6 py-16">
      <section className="max-w-3xl mx-auto">
        <header className="mb-10">
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
          <p className="text-base text-muted-foreground">
            Open-source, AI-native GTM engine. Lead finding, enrichment, qualification, and
            campaign orchestration — all driven from one CLI.
          </p>
        </header>

        <h2 className="font-heading text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Daily views
        </h2>
        <nav className="grid grid-cols-2 gap-3 mb-10">
          {PRIMARY.map((tile) => (
            <a
              key={tile.href}
              href={tile.href}
              data-testid={`nav-${tile.title.toLowerCase()}`}
              className="rounded-lg border border-border bg-card p-4 shadow-sm hover:shadow-md transition"
            >
              <div className="font-heading font-semibold">{tile.title}</div>
              <div className="text-sm text-muted-foreground">{tile.subtitle}</div>
            </a>
          ))}
        </nav>

        <h2 className="font-heading text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Legacy dashboards
        </h2>
        <nav className="grid grid-cols-2 gap-3">
          {LEGACY.map((tile) => (
            <a
              key={tile.href}
              href={tile.href}
              className="rounded-lg border border-dashed border-border bg-background p-4 hover:bg-card transition"
            >
              <div className="font-heading font-semibold">{tile.title}</div>
              <div className="text-sm text-muted-foreground">{tile.subtitle}</div>
            </a>
          ))}
        </nav>
        <p className="text-xs text-muted-foreground mt-3">
          Legacy dashboards remain available through 0.9.x and retire in 1.0.0.
        </p>
      </section>
    </main>
  )
}
