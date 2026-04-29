import tokens from '@brand/tokens.json'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/**
 * Brand kit verification page.
 *
 * Renders every token defined in web/brand/tokens.json so engineers can
 * eyeball brand integrity at a glance. This page is also the snapshot
 * reference for the brand-fidelity tests in the next sub-phase.
 */
export function BrandKit() {
  const colorEntries = Object.entries(tokens.colors).filter(
    ([, value]) => typeof value === 'string',
  ) as [string, string][]

  return (
    <main className="min-h-screen px-6 py-12 max-w-5xl mx-auto">
      <header className="mb-12">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
          Brand kit
        </p>
        <h1 className="font-heading text-5xl font-bold tracking-tight mb-3">
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          >
            YALC
          </span>{' '}
          design tokens
        </h1>
        <p className="text-muted-foreground max-w-prose">
          Every brand token is sourced from{' '}
          <code className="font-mono text-xs bg-card px-1.5 py-0.5 rounded-sm border border-border">
            web/brand/tokens.json
          </code>
          , captured from{' '}
          <a href={tokens.provenance.source} className="text-primary underline">
            {tokens.provenance.source}
          </a>{' '}
          on {tokens.provenance.fetchedAt}.
        </p>
      </header>

      <section className="mb-12">
        <h2 className="font-heading text-2xl font-semibold mb-4">Colors</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {colorEntries.map(([name, value]) => (
            <Card key={name} className="overflow-hidden">
              <div
                className="h-20 w-full border-b border-border"
                style={{ background: value }}
                aria-label={`${name} swatch`}
              />
              <CardContent className="p-3">
                <div className="font-heading text-sm font-semibold">{name}</div>
                <div className="font-mono text-xs text-muted-foreground truncate">{value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="mt-4 overflow-hidden">
          <div
            className="h-20"
            style={{ background: tokens.colors.primaryGradient }}
            aria-label="primary gradient"
          />
          <CardContent className="p-3">
            <div className="font-heading text-sm font-semibold">primaryGradient</div>
            <div className="font-mono text-xs text-muted-foreground">
              {tokens.colors.primaryGradient}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mb-12">
        <h2 className="font-heading text-2xl font-semibold mb-4">Typography</h2>
        <Card>
          <CardContent className="p-6 space-y-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Heading — {tokens.fonts.heading}
              </p>
              <p className="font-heading text-4xl font-bold tracking-tight">
                The fastest path to lift-off.
              </p>
            </div>
            <div>
              <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Body — {tokens.fonts.body}
              </p>
              <p className="text-base">
                Find your buyers, qualify them, and run outreach — all from one open-source CLI.
              </p>
            </div>
            <div>
              <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Mono — {tokens.fonts.mono}
              </p>
              <p className="font-mono text-sm">yalc-gtm leads:qualify --result-set 2026-04</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mb-12">
        <h2 className="font-heading text-2xl font-semibold mb-4">Buttons</h2>
        <Card>
          <CardContent className="p-6 flex flex-wrap gap-3">
            <Button>Default</Button>
            <Button variant="gradient">Gradient</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Link</Button>
            <Button variant="destructive">Destructive</Button>
          </CardContent>
        </Card>
      </section>

      <section className="mb-12">
        <h2 className="font-heading text-2xl font-semibold mb-4">Inputs &amp; badges</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Input</CardTitle>
              <CardDescription>Default text input with brand focus ring.</CardDescription>
            </CardHeader>
            <CardContent>
              <Input placeholder="othmane@earleads.com" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Badges</CardTitle>
              <CardDescription>Status pills using the same palette.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge>active</Badge>
              <Badge variant="secondary">beta</Badge>
              <Badge variant="outline">draft</Badge>
              <Badge variant="accent">new</Badge>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="font-heading text-2xl font-semibold mb-4">Card &amp; table</h2>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Token</TableHead>
                <TableHead>Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(tokens.radii).map(([k, v]) => (
                <TableRow key={`r-${k}`}>
                  <TableCell className="font-mono text-xs">radii.{k}</TableCell>
                  <TableCell className="font-mono text-xs">{v}</TableCell>
                </TableRow>
              ))}
              {Object.entries(tokens.shadows).map(([k, v]) => (
                <TableRow key={`s-${k}`}>
                  <TableCell className="font-mono text-xs">shadows.{k}</TableCell>
                  <TableCell className="font-mono text-xs truncate max-w-[420px]">{v}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>

      <footer className="mt-16 pt-6 border-t border-border text-sm text-muted-foreground">
        <p>
          Provenance: {tokens.provenance.method}.{' '}
          <a href="/" className="text-primary underline">
            Back to dashboard
          </a>
        </p>
      </footer>
    </main>
  )
}
