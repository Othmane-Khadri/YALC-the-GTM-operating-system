import type { CapabilityAdapter } from '../capabilities.js'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * asset-rendering adapter (Playwright provider, optional dependency).
 *
 * Strategy
 * --------
 * Playwright is declared in `optionalDependencies`. `npm install` / `pnpm
 * install` won't fail when the chromium binary can't be downloaded (CI,
 * sandboxes, restricted networks). The adapter tries a clean dynamic
 * `import('playwright')` once at module load; on failure the adapter is
 * still REGISTERED so `adapters:list` can show its availability flag, but
 * `isAvailable()` returns false and a clear `fallbackReason` is surfaced.
 *
 * On success the adapter renders HTML to PNG (full-page screenshot) or
 * PDF — `format: 'html'` always works (no Playwright needed) and just
 * writes the wrapped HTML to disk for downstream skills to ship as-is.
 *
 * NOTE: this replaces the dynamic-Function trampoline in the previous
 * asset-rendering stub. Modern bundlers and tsx/Node both honour
 * `import()` of a module string at runtime — the Function-trick was only
 * ever a workaround for older toolchains. Eslint and the YALC bundler
 * are happy without it.
 */

interface AssetRenderingInput {
  /** HTML or markdown body to render. */
  content?: string
  /** Output filename (relative to ~/.gtm-os/assets/). */
  filename?: string
  /** Render format. `html` always works; `pdf` and `png` need Playwright. */
  format?: 'html' | 'pdf' | 'png'
  title?: string
}

interface AssetRenderingResult {
  /** True if a real renderer wrote the asset (Playwright present, or html-only). */
  rendered: boolean
  /** Absolute path to the written file. Always present — even when the
   *  renderer is unavailable we preserve the source HTML. */
  path: string
  format: 'html' | 'pdf' | 'png'
  /** Human-readable reason when `rendered` is false. */
  fallbackReason: string | null
}

/** Minimal structural shape of the bits of Playwright we touch. Keeping
 *  this local avoids a hard `playwright` type dep when it's not installed. */
interface PlaywrightLike {
  chromium: {
    launch: () => Promise<PlaywrightBrowser>
  }
}
interface PlaywrightBrowser {
  newPage: () => Promise<PlaywrightPage>
  close: () => Promise<void>
}
interface PlaywrightPage {
  goto: (url: string) => Promise<unknown>
  pdf: (opts: { path: string }) => Promise<unknown>
  screenshot: (opts: { path: string; fullPage: boolean }) => Promise<unknown>
}

/**
 * Synchronous installed-check: probes `node_modules` via `require.resolve`
 * without actually loading Playwright. This lets `isAvailable()` answer
 * truthfully on first call (the registry probes adapters synchronously
 * during priority resolution), while the heavy import is deferred to
 * `execute()` so the CLI's cold-start cost stays low when nobody renders
 * a PDF/PNG.
 */
function isPlaywrightInstalled(): boolean {
  try {
    const req = createRequire(import.meta.url)
    req.resolve('playwright')
    return true
  } catch {
    return false
  }
}

let playwrightModule: PlaywrightLike | null = null
let playwrightLoadError: string | null = null
let playwrightInstalledOverride: boolean | null = null

async function loadPlaywright(): Promise<void> {
  if (playwrightModule) return
  if (!isPlaywrightAvailableSync()) {
    playwrightLoadError = 'playwright module not resolvable in node_modules'
    return
  }
  try {
    // Optional dependency — TS doesn't see it in node_modules during
    // typecheck on machines that haven't installed the optional dep, so
    // we suppress the TS resolver here. The runtime `import()` returns
    // the module when it's present and rejects with a clear error when
    // it isn't (handled below).
    // @ts-expect-error — optional dependency, typecheck without it installed
    const mod = (await import('playwright')) as PlaywrightLike
    playwrightModule = mod
    playwrightLoadError = null
  } catch (err) {
    playwrightModule = null
    playwrightLoadError = err instanceof Error ? err.message : String(err)
  }
}

function isPlaywrightAvailableSync(): boolean {
  if (playwrightInstalledOverride !== null) return playwrightInstalledOverride
  return isPlaywrightInstalled()
}

/**
 * Test-only hook. Lets unit tests stub the resolved module + installed
 * flag without actually `npm install`ing playwright. Returns a restore
 * function.
 */
export function __setPlaywrightModuleForTests(
  mod: PlaywrightLike | null,
  opts: { installed?: boolean | null; errorMessage?: string | null } = {},
): () => void {
  const prevMod = playwrightModule
  const prevErr = playwrightLoadError
  const prevInstalled = playwrightInstalledOverride
  playwrightModule = mod
  playwrightLoadError = opts.errorMessage ?? null
  playwrightInstalledOverride = opts.installed ?? (mod !== null)
  return () => {
    playwrightModule = prevMod
    playwrightLoadError = prevErr
    playwrightInstalledOverride = prevInstalled
  }
}

export const assetRenderingPlaywrightAdapter: CapabilityAdapter = {
  capabilityId: 'asset-rendering',
  providerId: 'playwright',
  isAvailable: () => {
    // Reflects whether the optional `playwright` dep is installed. We
    // probe `node_modules` synchronously via `require.resolve` so the
    // capability registry's priority-resolution loop gets a truthful
    // answer without paying the import cost up-front. Tests can force a
    // state via `__setPlaywrightModuleForTests`.
    return isPlaywrightAvailableSync()
  },
  async execute(input) {
    await loadPlaywright()

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

    if (!playwrightModule) {
      const hint = playwrightLoadError ? ` (underlying: ${playwrightLoadError})` : ''
      return {
        rendered: false,
        path: htmlPath,
        format,
        fallbackReason:
          `playwright not installed; run \`npm i playwright && npx playwright install chromium\` ` +
          `to enable ${format} rendering. HTML source preserved at ${htmlPath}.${hint}`,
      } satisfies AssetRenderingResult
    }

    // Playwright is available — render the requested binary format.
    const browser = await playwrightModule.chromium.launch()
    try {
      const page = await browser.newPage()
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
      // format === 'png'
      const outPath = join(baseDir, ensureExt(filename, '.png'))
      await page.screenshot({ path: outPath, fullPage: true })
      return {
        rendered: true,
        path: outPath,
        format: 'png',
        fallbackReason: null,
      } satisfies AssetRenderingResult
    } finally {
      await browser.close()
    }
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
