import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import tokens from '../../brand/tokens.json'
import tailwindConfig from '../../tailwind.config'

/**
 * Brand-token integrity contract.
 *
 * The Tailwind theme is generated from web/brand/tokens.json — every
 * theme color must therefore resolve to a brand token (no orphan
 * defaults). We also assert the on-disk JSON parses, the basic palette
 * is populated, and the webfont URL is reachable-shaped.
 */

const TOKENS_PATH = resolve(__dirname, '..', '..', 'brand', 'tokens.json')

describe('brand tokens', () => {
  it('tokens.json is valid JSON on disk', () => {
    const raw = readFileSync(TOKENS_PATH, 'utf-8')
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  it('declares a primary color and at least one secondary color', () => {
    expect(tokens.colors.primary).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(Array.isArray(tokens.colors.secondary)).toBe(true)
    expect(tokens.colors.secondary.length).toBeGreaterThanOrEqual(1)
    for (const hex of tokens.colors.secondary) {
      expect(typeof hex).toBe('string')
      expect(hex.length).toBeGreaterThan(0)
    }
  })

  it('declares a webfont URL and font family triplet', () => {
    expect(tokens.fonts.webfontUrl).toMatch(/^https:\/\//)
    expect(tokens.fonts.body).toMatch(/[A-Za-z]/)
    expect(tokens.fonts.heading).toMatch(/[A-Za-z]/)
    expect(tokens.fonts.mono).toMatch(/[A-Za-z]/)
  })

  it('every Tailwind theme color resolves to a brand token (no orphans)', () => {
    // Flatten the resolved theme.colors object to leaf string values, then
    // verify each leaf appears somewhere in tokens.json. Anything else
    // would be a hardcoded default that bypassed the brand pipeline.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const colors = (tailwindConfig as any).theme?.extend?.colors ?? {}
    const tokenJson = JSON.stringify(tokens)

    const leaves: string[] = []
    const collect = (v: unknown) => {
      if (typeof v === 'string') leaves.push(v)
      else if (v && typeof v === 'object') {
        for (const child of Object.values(v as Record<string, unknown>)) collect(child)
      }
    }
    collect(colors)

    expect(leaves.length).toBeGreaterThan(0)
    for (const leaf of leaves) {
      expect(tokenJson).toContain(leaf)
    }
  })
})
