import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Asset-rendering Playwright adapter — covers:
 *   1. isAvailable() flips with playwright presence.
 *   2. format='html' always works (no Playwright needed).
 *   3. format='pdf' falls back with a clear `playwright not installed` reason.
 *   4. format='png' renders successfully when Playwright is shimmed.
 *   5. The runtime `Function('m', 'return import(m)')` hack is gone.
 */

describe('asset-rendering-playwright adapter — availability', () => {
  afterEach(() => {
    // each test installs its own restore; this is just a safety net.
  })

  it('isAvailable() returns false when playwright is not installed', async () => {
    const mod = await import('../lib/providers/adapters/asset-rendering-playwright')
    const restore = mod.__setPlaywrightModuleForTests(null, {
      installed: false,
      errorMessage: 'simulated: not installed',
    })
    try {
      expect(mod.assetRenderingPlaywrightAdapter.isAvailable?.()).toBe(false)
    } finally {
      restore()
    }
  })

  it('isAvailable() returns true when playwright is shimmed as installed', async () => {
    const mod = await import('../lib/providers/adapters/asset-rendering-playwright')
    const restore = mod.__setPlaywrightModuleForTests({} as never, { installed: true })
    try {
      expect(mod.assetRenderingPlaywrightAdapter.isAvailable?.()).toBe(true)
    } finally {
      restore()
    }
  })
})

describe('asset-rendering-playwright adapter — execute', () => {
  it('format=html writes a wrapped HTML file even when Playwright is absent', async () => {
    const mod = await import('../lib/providers/adapters/asset-rendering-playwright')
    const restore = mod.__setPlaywrightModuleForTests(null, { installed: false })
    try {
      const filename = `pw-test-html-${Date.now()}.html`
      const out = (await mod.assetRenderingPlaywrightAdapter.execute(
        { content: '<h1>Hello</h1>', filename, format: 'html', title: 'Hi' },
        { executor: null, registry: null as never },
      )) as { rendered: boolean; path: string; format: string; fallbackReason: string | null }
      expect(out.rendered).toBe(true)
      expect(out.format).toBe('html')
      expect(out.path).toMatch(/\.html$/)
      expect(existsSync(out.path)).toBe(true)
      const body = readFileSync(out.path, 'utf-8')
      expect(body).toContain('<h1>Hello</h1>')
      expect(body).toContain('<title>Hi</title>')
    } finally {
      restore()
    }
  })

  it('format=pdf returns a clear fallback when Playwright is absent', async () => {
    const mod = await import('../lib/providers/adapters/asset-rendering-playwright')
    const restore = mod.__setPlaywrightModuleForTests(null, {
      installed: false,
      errorMessage: 'simulated import failure',
    })
    try {
      const filename = `pw-test-pdf-${Date.now()}.pdf`
      const out = (await mod.assetRenderingPlaywrightAdapter.execute(
        { content: '<h1>Doc</h1>', filename, format: 'pdf' },
        { executor: null, registry: null as never },
      )) as { rendered: boolean; format: string; fallbackReason: string }
      expect(out.rendered).toBe(false)
      expect(out.format).toBe('pdf')
      expect(out.fallbackReason).toMatch(/playwright not installed/)
      expect(out.fallbackReason).toMatch(/npm i playwright/)
    } finally {
      restore()
    }
  })

  it('format=png renders successfully via a shimmed Playwright module', async () => {
    const mod = await import('../lib/providers/adapters/asset-rendering-playwright')

    const tmp = mkdtempSync(join(tmpdir(), 'pw-shim-'))
    let screenshotPath = ''
    let gotoCalls = 0

    const fakePlaywright = {
      chromium: {
        launch: async () => ({
          newPage: async () => ({
            goto: async (_url: string) => {
              gotoCalls++
            },
            pdf: async (_opts: { path: string }) => {
              throw new Error('pdf path not exercised in this test')
            },
            screenshot: async (opts: { path: string; fullPage: boolean }) => {
              screenshotPath = opts.path
              expect(opts.fullPage).toBe(true)
              // Simulate the renderer dropping a tiny binary on disk.
              const { writeFileSync } = await import('node:fs')
              writeFileSync(opts.path, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
            },
          }),
          close: async () => {},
        }),
      },
    }

    const restore = mod.__setPlaywrightModuleForTests(fakePlaywright as never, { installed: true })
    try {
      const filename = `pw-shim-${Date.now()}.png`
      const out = (await mod.assetRenderingPlaywrightAdapter.execute(
        { content: '<h1>Snap</h1>', filename, format: 'png' },
        { executor: null, registry: null as never },
      )) as { rendered: boolean; path: string; format: string; fallbackReason: string | null }

      expect(out.rendered).toBe(true)
      expect(out.format).toBe('png')
      expect(out.path).toMatch(/\.png$/)
      expect(out.fallbackReason).toBeNull()
      expect(gotoCalls).toBe(1)
      expect(screenshotPath).toBe(out.path)
      // Buffer-on-disk shape — the adapter returns a path; downstream code
      // can read it as a Buffer if needed.
      expect(existsSync(out.path)).toBe(true)
    } finally {
      restore()
      // tmp is best-effort cleanup; the adapter writes under ~/.gtm-os/assets.
      void tmp
    }
  })
})

describe('asset-rendering-playwright source — no runtime Function hack', () => {
  it('does not contain `new Function("m", "return import(m)")` or equivalent', async () => {
    const path = join(
      process.cwd(),
      'src',
      'lib',
      'providers',
      'adapters',
      'asset-rendering-playwright.ts',
    )
    const src = readFileSync(path, 'utf-8')
    // The whole point of the migration: kill the dynamic-Function trampoline.
    expect(src).not.toMatch(/new Function\([^)]*return import/)
  })
})
