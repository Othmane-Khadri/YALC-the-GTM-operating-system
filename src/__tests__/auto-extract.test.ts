import { describe, it, expect } from 'vitest'
import {
  deriveNameFromUrl,
  extractCompanyDescription,
  extractCompanyMeta,
  extractCompanyName,
} from '../lib/onboarding/auto-extract'

/**
 * Item 18 — Auto-extract company metadata from scraped sources.
 *
 * The extractor must never invent data. Any field it can't find from a
 * meta tag, title, h1, or paragraph stays undefined and the caller leaves
 * the corresponding `CompanyContext` slot empty.
 */

describe('extractCompanyName', () => {
  it('prefers og:site_name over title and h1', () => {
    const html = `
      <head>
        <title>Acme Corp — Buy widgets</title>
        <meta property="og:site_name" content="Acme Corp Inc" />
      </head>
      <body><h1>Welcome</h1></body>
    `
    expect(extractCompanyName(html)).toBe('Acme Corp Inc')
  })

  it('handles og:site_name with reversed attribute order', () => {
    const html = `<meta content="Reverse Co" property="og:site_name" />`
    expect(extractCompanyName(html)).toBe('Reverse Co')
  })

  it('falls back to <title> with a separator-trim', () => {
    const html = '<title>Bitwip — AI agency for SMBs</title>'
    expect(extractCompanyName(html)).toBe('Bitwip')
  })

  it('keeps the full title when there is no separator', () => {
    expect(extractCompanyName('<title>Just Bitwip</title>')).toBe('Just Bitwip')
  })

  it('handles colon and pipe separators in titles', () => {
    expect(extractCompanyName('<title>Foo: a really fast tool</title>')).toBe('Foo')
    expect(extractCompanyName('<title>Foo | Tagline</title>')).toBe('Foo')
  })

  it('falls back to the first H1 in markdown content', () => {
    expect(extractCompanyName('# Bitwip\n\nWe build agents.')).toBe('Bitwip')
  })

  it('falls back to <h1> in HTML when no meta or title is present', () => {
    expect(extractCompanyName('<body><h1>Acme <span>Inc</span></h1></body>')).toBe('Acme Inc')
  })

  it('returns undefined when no signal is available', () => {
    expect(extractCompanyName('   ')).toBeUndefined()
    expect(extractCompanyName('')).toBeUndefined()
  })
})

describe('deriveNameFromUrl', () => {
  it('strips www. and tld, title-cases the brand', () => {
    expect(deriveNameFromUrl('https://bitwip.ai')).toBe('Bitwip')
    expect(deriveNameFromUrl('https://www.acme-corp.com')).toBe('Acme Corp')
  })

  it('returns the first label when subdomains are present', () => {
    expect(deriveNameFromUrl('https://anthropic.com/news')).toBe('Anthropic')
  })

  it('returns undefined for invalid URLs', () => {
    expect(deriveNameFromUrl('not a url')).toBeUndefined()
    expect(deriveNameFromUrl('')).toBeUndefined()
  })
})

describe('extractCompanyDescription', () => {
  it('prefers <meta name="description"> over og:description', () => {
    const html = `
      <meta name="description" content="The canonical pitch." />
      <meta property="og:description" content="OG fallback pitch." />
    `
    expect(extractCompanyDescription(html)).toBe('The canonical pitch.')
  })

  it('falls back to og:description when no name=description is present', () => {
    const html = `<meta property="og:description" content="OG only pitch." />`
    expect(extractCompanyDescription(html)).toBe('OG only pitch.')
  })

  it('handles reversed attribute order on meta tags', () => {
    const html = `<meta content="Reversed pitch." name="description" />`
    expect(extractCompanyDescription(html)).toBe('Reversed pitch.')
  })

  it('falls back to the first long body paragraph when meta tags absent', () => {
    const html = `
      <p>nav</p>
      <p>${'Long form pitch about why our product is the right answer to a hard problem. '.repeat(2)}</p>
    `
    const out = extractCompanyDescription(html)
    expect(out).toContain('Long form pitch')
  })

  it('clamps long descriptions to ~600 chars', () => {
    const long = 'word '.repeat(400) // ~2000 chars
    const html = `<meta name="description" content="${long}" />`
    const out = extractCompanyDescription(html)
    expect(out).toBeDefined()
    expect(out!.length).toBeLessThanOrEqual(601) // includes ellipsis
  })

  it('returns undefined when the page has no readable body text', () => {
    expect(extractCompanyDescription('<title>nope</title>')).toBeUndefined()
  })
})

describe('extractCompanyMeta', () => {
  it('uses the URL fallback when content has no name', () => {
    const out = extractCompanyMeta({ content: '   ', url: 'https://bitwip.ai' })
    expect(out.name).toBe('Bitwip')
  })

  it('combines content-derived name + description into one result', () => {
    const html = `
      <title>Acme — fast widgets</title>
      <meta name="description" content="We sell widgets." />
    `
    const out = extractCompanyMeta({ content: html, url: 'https://acme.com' })
    expect(out.name).toBe('Acme')
    expect(out.description).toBe('We sell widgets.')
  })

  it('returns undefineds when neither content nor URL provide signals', () => {
    expect(extractCompanyMeta({ content: '' }).name).toBeUndefined()
    expect(extractCompanyMeta({ content: '' }).description).toBeUndefined()
  })
})
