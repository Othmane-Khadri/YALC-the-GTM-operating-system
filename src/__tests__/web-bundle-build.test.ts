import { describe, it, expect, beforeAll } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, resolve } from 'node:path'

/**
 * Bundle-shape contract for the web SPA.
 *
 * The build is run once before the suite (it's idempotent and ~700ms in
 * the worktree). Subsequent assertions read the dist/ tree to verify
 * shape, size, and that nothing leaked from node_modules.
 */

const ROOT = resolve(__dirname, '..', '..')
const WEB = join(ROOT, 'web')
const DIST = join(WEB, 'dist')
const ASSETS = join(DIST, 'assets')

beforeAll(() => {
  // Build the SPA. We swallow stdout but surface stderr/non-zero exits so
  // a broken build fails the suite with a clear error.
  //
  // NOTE: vitest sets NODE_ENV=test, which Vite respects for plugin
  // behaviour and (more importantly) skips esbuild minification. Force
  // production mode so the bundle the test inspects matches what ships
  // in the published tarball.
  const env = { ...process.env, NODE_ENV: 'production' }
  execSync('pnpm --silent build', {
    cwd: WEB,
    stdio: ['ignore', 'ignore', 'inherit'],
    env,
  })
}, 120_000)

describe('web bundle build', () => {
  it('emits dist/index.html', () => {
    const indexPath = join(DIST, 'index.html')
    expect(existsSync(indexPath)).toBe(true)
    const html = readFileSync(indexPath, 'utf-8')
    expect(html).toContain('<div id="root">')
  })

  it('emits at least one JS asset', () => {
    expect(existsSync(ASSETS)).toBe(true)
    const files = readdirSync(ASSETS)
    const jsFiles = files.filter((f) => f.endsWith('.js'))
    expect(jsFiles.length).toBeGreaterThan(0)
  })

  it('keeps total JS under the size budget (250 KB raw, 250 KB gzipped)', () => {
    const files = readdirSync(ASSETS).filter((f) => f.endsWith('.js'))
    let rawTotal = 0
    let gzipTotal = 0
    for (const f of files) {
      const buf = readFileSync(join(ASSETS, f))
      rawTotal += statSync(join(ASSETS, f)).size
      gzipTotal += gzipSync(buf).length
    }
    expect(rawTotal).toBeLessThan(250 * 1024)
    expect(gzipTotal).toBeLessThan(250 * 1024)
  })

  it('does not leak node_modules paths into the built assets', () => {
    const files = readdirSync(ASSETS)
    for (const f of files) {
      const content = readFileSync(join(ASSETS, f), 'utf-8')
      // A leak would look like an absolute path to node_modules at build
      // time. Vite normalises imports but absolute paths slip in via
      // sourcemaps or banner comments; we keep them out.
      expect(content).not.toMatch(/[/\\]node_modules[/\\]/)
    }
  })
})
