import type { CapabilityAdapter } from '../capabilities.js'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

interface AssetRenderingInput {
  /** HTML or markdown body to render. */
  content?: string
  /** Output filename (relative to ~/.gtm-os/assets/). */
  filename?: string
  /** Render format. Currently `html` (always) and `pdf` (Playwright). */
  format?: 'html' | 'pdf' | 'png'
  title?: string
}

interface AssetRenderingResult {
  /** True if a real renderer wrote the asset (Playwright present). */
  rendered: boolean
  /** Absolute path to the written file. Always present — even in stub mode we
   *  write the source HTML so downstream skills can hand it back to a user. */
  path: string
  format: 'html' | 'pdf' | 'png'
  /** Human-readable reason when `rendered` is false. */
  fallbackReason: string | null
}

/**
 * asset-rendering adapter (built-in, lazy Playwright).
 *
 * The Playwright dep is OPTIONAL. We try to import it lazily; if missing or
 * the system Chromium isn't installed, we fall back to writing the raw HTML
 * to disk and returning a `fallbackReason` explaining how to upgrade. Skill
 * authors can branch on `rendered` to decide whether to ship the asset or
 * tell the user to install Playwright.
 *
 * This keeps the bundled CLI lightweight (no chromium download on `npm i`)
 * while still letting power users opt in to a real headless renderer.
 */
export const assetRenderingStubAdapter: CapabilityAdapter = {
  capabilityId: 'asset-rendering',
  providerId: 'builtin',
  isAvailable: () => true,
  async execute(input) {
    const raw = (input ?? {}) as AssetRenderingInput
    const content = (raw.content ?? '').toString()
    const filename = (raw.filename ?? `asset-${Date.now()}.html`).replace(/[^a-zA-Z0-9._-]/g, '_')
    const format = raw.format ?? 'html'
    const title = raw.title ?? 'YALC asset'

    if (!content) {
      return {
        rendered: false,
        path: '',
        format,
        fallbackReason: 'asset-rendering input requires `content` (string)',
      } satisfies AssetRenderingResult
    }

    const baseDir = join(homedir(), '.gtm-os', 'assets')
    if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true })
    const baseHtml = wrapHtml(title, content)
    const htmlPath = join(baseDir, ensureExt(filename, '.html'))
    if (!existsSync(dirname(htmlPath))) mkdirSync(dirname(htmlPath), { recursive: true })
    writeFileSync(htmlPath, baseHtml, 'utf-8')

    if (format === 'html') {
      return {
        rendered: true,
        path: htmlPath,
        format: 'html',
        fallbackReason: null,
      } satisfies AssetRenderingResult
    }

    // Try Playwright for pdf / png. Lazy import keeps the dep optional.
    try {
      // Use Function() to bypass static module-resolution — Playwright is an
      // optional runtime dep that may not be installed in the user's env.
      const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>
      const playwright = (await dynamicImport('playwright')) as {
        chromium: { launch: () => Promise<{ newPage: () => Promise<unknown>; close: () => Promise<void> }> }
      }
      const browser = await playwright.chromium.launch()
      try {
        const page = (await browser.newPage()) as {
          goto: (url: string) => Promise<unknown>
          pdf: (opts: { path: string }) => Promise<unknown>
          screenshot: (opts: { path: string; fullPage: boolean }) => Promise<unknown>
        }
        await page.goto(`file://${htmlPath}`)
        if (format === 'pdf') {
          const outPath = join(baseDir, ensureExt(filename, '.pdf'))
          await page.pdf({ path: outPath })
          return {
            rendered: true,
            path: outPath,
            format: 'pdf',
            fallbackReason: null,
          } satisfies AssetRenderingResult
        }
        if (format === 'png') {
          const outPath = join(baseDir, ensureExt(filename, '.png'))
          await page.screenshot({ path: outPath, fullPage: true })
          return {
            rendered: true,
            path: outPath,
            format: 'png',
            fallbackReason: null,
          } satisfies AssetRenderingResult
        }
      } finally {
        await browser.close()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        rendered: false,
        path: htmlPath,
        format,
        fallbackReason:
          `asset rendering for "${format}" requires Playwright; install via \`npm i playwright && npx playwright install chromium\`. ` +
          `HTML source has been preserved at ${htmlPath}. (Underlying: ${message})`,
      } satisfies AssetRenderingResult
    }

    return {
      rendered: true,
      path: htmlPath,
      format: 'html',
      fallbackReason: null,
    } satisfies AssetRenderingResult
  },
}

function wrapHtml(title: string, body: string): string {
  if (/<html[\s>]/i.test(body)) return body
  const safeTitle = title.replace(/</g, '&lt;')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:780px;margin:48px auto;padding:0 24px;color:#111}h1,h2,h3{font-weight:600}img{max-width:100%}</style>
</head><body>${body}</body></html>`
}

function ensureExt(name: string, ext: string): string {
  return name.endsWith(ext) ? name : name.replace(/\.[a-z0-9]+$/i, '') + ext
}
