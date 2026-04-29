import type { CapabilityAdapter } from '../capabilities.js'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface LandingPageDeployInput {
  /** HTML body (full document or fragment). */
  html?: string
  /** Slug to publish under (e.g. `cmo-playbook`). */
  slug?: string
  title?: string
}

interface LandingPageDeployResult {
  /** True when an upstream deploy provider (vercel-mcp etc.) actually pushed. */
  deployed: boolean
  /** Either the deployed URL or a `file://` path to the local fallback page. */
  url: string
  fallbackReason: string | null
}

/**
 * landing-page-deploy adapter (vercel-mcp, with local-fallback stub).
 *
 * The 0.9.F build doesn't ship a real Vercel MCP integration — when no
 * `VERCEL_MCP_URL`/`VERCEL_TOKEN` is configured we write the page to
 * `~/.gtm-os/landing-pages/<slug>/index.html` and return that file path
 * with `deployed: false` plus a clear `fallbackReason`. Skill authors
 * branch on `deployed` to render either a "click to view" link or a
 * "configure Vercel MCP to publish" instruction.
 *
 * Real deploy support lands behind the same provider id (`vercel-mcp`)
 * once the MCP adapter exists; the contract here will not change.
 */
export const landingPageDeployStubAdapter: CapabilityAdapter = {
  capabilityId: 'landing-page-deploy',
  providerId: 'vercel-mcp',
  isAvailable: () => true,
  async execute(input) {
    const raw = (input ?? {}) as LandingPageDeployInput
    const html = (raw.html ?? '').toString()
    const slug = ((raw.slug ?? `page-${Date.now()}`) + '').replace(/[^a-z0-9-]/gi, '-').toLowerCase()
    const title = raw.title ?? slug

    if (!html) {
      return {
        deployed: false,
        url: '',
        fallbackReason: 'landing-page-deploy input requires `html` (string)',
      } satisfies LandingPageDeployResult
    }

    const dir = join(homedir(), '.gtm-os', 'landing-pages', slug)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'index.html')
    writeFileSync(filePath, ensureFullHtml(title, html), 'utf-8')

    const fallbackReason =
      'No Vercel MCP configured — page written locally only. ' +
      'Install vercel-mcp and set VERCEL_MCP_URL + VERCEL_TOKEN to enable real deploys, ' +
      `then re-run the skill. Local preview: file://${filePath}`

    return {
      deployed: false,
      url: `file://${filePath}`,
      fallbackReason,
    } satisfies LandingPageDeployResult
  },
}

function ensureFullHtml(title: string, body: string): string {
  if (/<html[\s>]/i.test(body)) return body
  const safe = title.replace(/</g, '&lt;')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safe}</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:780px;margin:48px auto;padding:0 24px;color:#111}h1,h2,h3{font-weight:600}img{max-width:100%}</style>
</head><body>${body}</body></html>`
}
