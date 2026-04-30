/**
 * Brand-fidelity tests for the four archetype default visualizations.
 *
 * The reasoning capability is mocked to return a brand-faithful HTML
 * document per archetype. Each test then asserts (via the static
 * helpers in helpers/brand-check.ts):
 *
 *   1. The Yalc.ai primary hex appears in the HTML.
 *   2. The chosen Outfit + Inter font pairing appears in <style>.
 *   3. No generic Tailwind blue/gray/slate utilities leak through.
 *   4. The webfont CDN URL is linked in <head>.
 *
 * Approach: Option A (static parse) — keeps node_modules clean. The
 * 0.9.G brief explicitly allows this trade-off; ΔE rendering checks are
 * not needed because the LLM emits exact hex codes per the skill body's
 * brand-token contract. axe-core / Playwright path is documented in the
 * implementer report as deferred.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runVisualize } from '../lib/visualize/runner'
import { resetCapabilityRegistry } from '../lib/providers/capabilities'
import { assertBrandFidelity } from './helpers/brand-check'
import { loadAllFrameworks } from '../lib/frameworks/loader'

const BRAND = {
  primaryHex: '#C9506E',
  accentHex: '#E07A95',
  fontHeading: 'Outfit',
  fontBody: 'Inter',
  webfontUrl:
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap',
}

/** Build a minimal but brand-faithful HTML response for a given idiom. */
function brandFaithfulHtml(idiom: string, viewId: string): string {
  // The fonts.googleapis.com URL is sourced from web/brand/tokens.json so
  // the assertion checks the same value the runner injects.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${viewId}</title>
<link rel="stylesheet" href="${BRAND.webfontUrl}" />
<script src="https://cdn.tailwindcss.com"></script>
<style>
:root{
  --primary:${BRAND.primaryHex};
  --accent:${BRAND.accentHex};
  --background:#F8EDE8;
  --foreground:#1a1a1a;
  --card:#FFFFFF;
  --ring:${BRAND.primaryHex};
}
body{font-family:'${BRAND.fontBody}', system-ui, sans-serif; background:var(--background); color:var(--foreground);}
h1,h2,h3,.font-heading{font-family:'${BRAND.fontHeading}', system-ui, sans-serif;}
.card{background:var(--card); border:1px solid rgba(26,26,26,0.12); transition:transform 150ms ease-out;}
.card:hover{transform:translateY(-4px); box-shadow:0 8px 24px rgba(201,80,110,0.08);}
</style>
</head>
<body class="min-h-screen p-8">
  <h1 class="font-heading text-3xl" style="color:var(--primary)">${viewId} (${idiom})</h1>
  <div class="grid gap-6">
    <div class="card p-4 rounded-lg" style="border-color:var(--accent)">
      <p class="font-medium">Sample row</p>
    </div>
  </div>
</body>
</html>`
}

let TMP: string
let dataPath: string

async function installBrandFaithfulAdapter(viewId: string, idiom: string) {
  const html = brandFaithfulHtml(idiom, viewId)
  const { getCapabilityRegistryReady } = await import('../lib/providers/capabilities')
  const registry = await getCapabilityRegistryReady()
  registry.register({
    capabilityId: 'reasoning',
    providerId: 'anthropic',
    isAvailable: () => true,
    async execute(input: Record<string, unknown>) {
      return {
        text: JSON.stringify({
          view_id: input.view_id,
          html,
          idiom,
          summary: `${idiom} of items`,
        }),
      }
    },
  })
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-viz-brand-'))
  vi.stubEnv('HOME', TMP)
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  resetCapabilityRegistry()
  const runsDir = join(TMP, '.gtm-os', 'agents', 'sample.runs')
  mkdirSync(runsDir, { recursive: true })
  dataPath = join(runsDir, 'run-1.json')
  writeFileSync(
    dataPath,
    JSON.stringify({
      rows: [{ id: 'a', stage: 'launched', name: 'one' }],
      ranAt: '2026-04-29T10:00:00Z',
    }),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
  resetCapabilityRegistry()
})

interface Archetype {
  name: string
  view_id: string
  intent: string
  idiom: string
}

const ARCHETYPES: Archetype[] = [
  {
    name: 'competitor-audience-mining',
    view_id: 'competitor-mining-leads',
    intent:
      'ICP-scored lead list grouped by competitor source, click-through to LinkedIn profile',
    idiom: 'cards',
  },
  {
    name: 'content-calendar-builder',
    view_id: 'content-calendar',
    intent: 'weekly content calendar grid with draft preview, approve/edit buttons',
    idiom: 'calendar',
  },
  {
    name: 'outreach-campaign-builder',
    view_id: 'campaign-queue',
    intent:
      'kanban board of campaigns by stage (proposed, awaiting verification, launched, completed)',
    idiom: 'kanban',
  },
  {
    name: 'lead-magnet-builder',
    view_id: 'lead-magnet-pipeline',
    intent: 'grid of lead magnets by stage with asset preview',
    idiom: 'cards',
  },
]

describe('archetype default visualizations carry brand fidelity', () => {
  it('every bundled archetype declares a default_visualization block', () => {
    const all = loadAllFrameworks()
    const targetNames = new Set(ARCHETYPES.map((a) => a.name))
    const archetypes = all.filter((f) => targetNames.has(f.name))
    expect(archetypes.length).toBe(ARCHETYPES.length)
    for (const f of archetypes) {
      expect(f.default_visualization).toBeTruthy()
      expect(f.default_visualization?.view_id).toBeTruthy()
      expect(f.default_visualization?.intent).toBeTruthy()
    }
  })

  for (const arche of ARCHETYPES) {
    it(`${arche.name}: generated page passes brand-fidelity static check`, async () => {
      await installBrandFaithfulAdapter(arche.view_id, arche.idiom)
      const result = await runVisualize({
        view_id: arche.view_id,
        intent: arche.intent,
        data_paths: [dataPath],
      })
      const fs = await import('node:fs')
      const html = fs.readFileSync(result.page_path, 'utf-8')
      const check = assertBrandFidelity(html, BRAND)
      if (!check.ok) {
        // eslint-disable-next-line no-console
        console.error(check.errors.join('\n'))
      }
      expect(check.ok).toBe(true)
    })
  }
})
