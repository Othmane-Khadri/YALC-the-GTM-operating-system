/**
 * Regression tests for 0.9.5 onboarding extraction fixes.
 *
 * These bugs were silent-degradation issues that ran against real websites:
 * none threw, none 500'd, the captured context was just full of garbage
 * (tagline-as-name, markdown-soup-as-description, empty pain_points after
 * synthesis ran). The mocked happy-path tests passed; live URLs broke.
 *
 * The tests below pin the FIXED behavior against representative inputs that
 * mirror what Firecrawl returns for tagline-style sites and what the LLM
 * emits as ICP / positioning / voice bodies.
 */

import { describe, it, expect } from 'vitest'
import { extractCompanyName, extractCompanyDescription, looksLikeBrand } from '../lib/onboarding/auto-extract'
import { extractStructuredFields } from '../lib/onboarding/synthesis'

describe('Bug 2 — looksLikeBrand gate on title-derived names', () => {
  it('rejects tagline-style titles even when they have no separator', () => {
    expect(looksLikeBrand('Your go-to-market operating system from Claude Code')).toBe(false)
    expect(looksLikeBrand('The fastest way to build an AI agent')).toBe(false)
    expect(looksLikeBrand('A platform for growing teams')).toBe(false)
  })

  it('accepts plausible brand names', () => {
    expect(looksLikeBrand('Yalc')).toBe(true)
    expect(looksLikeBrand('YALC GTM-OS')).toBe(true)
    expect(looksLikeBrand('Acme Corp')).toBe(true)
    expect(looksLikeBrand('Earleads')).toBe(true)
  })

  it('rejects strings that are too long or have too many words', () => {
    expect(looksLikeBrand('The Quick Brown Fox Jumps Over')).toBe(false)
    expect(looksLikeBrand('a'.repeat(40))).toBe(false)
  })

  it('extractCompanyName rejects a tagline title and falls through', () => {
    const html = `<html><head><title>Your go-to-market operating system from Claude Code.</title></head><body></body></html>`
    expect(extractCompanyName(html)).toBeUndefined()
  })

  it('extractCompanyName accepts a title with a brand-shaped first segment', () => {
    const html = `<html><head><title>Yalc — Your go-to-market operating system</title></head><body></body></html>`
    expect(extractCompanyName(html)).toBe('Yalc')
  })

  it('extractCompanyName prefers og:site_name over title even when title is brand-shaped', () => {
    const html = `<html><head><meta property="og:site_name" content="YALC"><title>Yalc — Your go-to-market operating system</title></head></html>`
    expect(extractCompanyName(html)).toBe('YALC')
  })

  it('extractCompanyName falls through to h1 when title is a tagline', () => {
    const md = `<html><head><title>The fastest way to grow your pipeline</title></head><body><h1>Acme</h1></body></html>`
    expect(extractCompanyName(md)).toBe('Acme')
  })

  it('extractCompanyName rejects a tagline-style h1 too', () => {
    const md = `<html><head><title>Build at warp speed</title></head><body><h1>The fastest way to ship code</h1></body></html>`
    expect(extractCompanyName(md)).toBeUndefined()
  })
})

describe('Bug 3 — description fallback rejects markdown soup', () => {
  it('rejects demo terminal output blocks', () => {
    const md = `# Yalc

→ Found 0 leads
→ Enriched 142/142 contacts
→ 99% match rate against your ICP segment Series A SaaS

Yalc lets you build a complete go-to-market engine in your terminal so your team ships outreach faster.`
    const out = extractCompanyDescription(md)
    expect(out).toBeDefined()
    expect(out).toContain('Yalc lets you build')
    expect(out).not.toContain('Found 0 leads')
    expect(out).not.toContain('142/142')
  })

  it('rejects link-cluster soup', () => {
    const md = `# Site

[home](https://x) [docs](https://x/docs) [pricing](https://x/p) [blog](https://x/b) [github](https://x/gh) [discord](https://x/d) [twitter](https://x/t)

Acme provides a managed platform that helps teams enable revenue programs faster than building internal tools alone.`
    const out = extractCompanyDescription(md)
    expect(out).toBeDefined()
    expect(out).toContain('Acme provides')
    expect(out).not.toContain('home')
  })

  it('still picks up real meta description when present', () => {
    const html = `<html><head><meta name="description" content="Acme is the platform that helps revenue teams ship faster."></head></html>`
    const out = extractCompanyDescription(html)
    expect(out).toBe('Acme is the platform that helps revenue teams ship faster.')
  })

  it('falls back to a prose paragraph when meta is missing', () => {
    const md = `# Acme

Acme is a developer platform that helps growing engineering teams build, deploy, and observe their applications across multiple cloud regions without rewriting code.`
    const out = extractCompanyDescription(md)
    expect(out).toBeDefined()
    expect(out).toContain('Acme is a developer platform')
  })

  it('returns undefined when nothing prose-shaped is available', () => {
    const md = `# Foo\n\n→ stat 1\n\n→ stat 2\n\n[a](u) [b](u) [c](u) [d](u) [e](u)`
    expect(extractCompanyDescription(md)).toBeUndefined()
  })
})

describe('Bug 1 — extractStructuredFields back-writes after synthesis', () => {
  it('extracts pain_points and competitors from a top-level ICP yaml', () => {
    const icpBody = `
segments:
  - name: SaaS founders
    description: Series A founders building outbound from scratch
pain_points:
  - Hiring SDRs is too slow
  - Tooling stack is too expensive
  - Personalization at scale is hard
competitors:
  - Apollo
  - Outreach
  - Salesloft
`
    const out = extractStructuredFields({ icpBody })
    expect(out.pain_points).toEqual([
      'Hiring SDRs is too slow',
      'Tooling stack is too expensive',
      'Personalization at scale is hard',
    ])
    expect(out.competitors).toEqual(['Apollo', 'Outreach', 'Salesloft'])
    expect(out.segments_freeform).toContain('SaaS founders')
  })

  it('falls back to per-segment pain_points/competitors when not at root', () => {
    const icpBody = `
segments:
  - name: HR-tech buyers
    description: Heads of People at 200-1000 person companies
    pain_points:
      - Compliance varies by region
      - Existing payroll tools fragment global data
    competitors:
      - Deel
      - Remote
`
    const out = extractStructuredFields({ icpBody })
    expect(out.pain_points).toContain('Compliance varies by region')
    expect(out.competitors).toEqual(expect.arrayContaining(['Deel', 'Remote']))
  })

  it('extracts subreddits and target_communities from audience_hangouts', () => {
    const icpBody = `
segments:
  - name: Indie founders
audience_hangouts:
  subreddits: ["SaaS", "r/Entrepreneur"]
  target_communities:
    - Indie Hackers
    - On Deck
`
    const out = extractStructuredFields({ icpBody })
    expect(out.subreddits).toEqual(['SaaS', 'Entrepreneur'])
    expect(out.target_communities).toEqual(['Indie Hackers', 'On Deck'])
  })

  it('back-fills competitors from positioning battlecards when ICP omits them', () => {
    const positioningBody = `# Positioning

Acme wins on speed.

---BATTLECARD: deel---
Deel positions on payroll breadth.
---BATTLECARD: remote---
Remote positions on entity-as-a-service.
`
    const out = extractStructuredFields({ positioningBody })
    expect(out.competitors).toEqual(expect.arrayContaining(['deel', 'remote']))
  })

  it('synthesizes voice_summary from the first prose paragraph of the voice body', () => {
    const voiceBody = `# Tone of voice

Direct. Specific. Builder-led. We write like an engineer talking to another engineer over coffee — concrete examples, no buzzwords, no SaaS-marketing fluff.

## Examples

- "We shipped an outreach engine in 4 days."
- "Skip the demo, here's the GitHub link."
`
    const out = extractStructuredFields({ voiceBody })
    expect(out.voice_summary).toContain('Direct.')
    expect(out.voice_summary.length).toBeGreaterThan(40)
  })

  it('returns empty fields when no inputs match', () => {
    const out = extractStructuredFields({})
    expect(out.pain_points).toEqual([])
    expect(out.competitors).toEqual([])
    expect(out.segments_freeform).toBe('')
    expect(out.subreddits).toEqual([])
    expect(out.target_communities).toEqual([])
    expect(out.voice_summary).toBe('')
  })
})
