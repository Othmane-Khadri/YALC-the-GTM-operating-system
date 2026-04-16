import { describe, it, expect } from 'vitest'
import { chunkMarkdown, stableHash, approximateTokens } from '../chunker.js'

describe('chunkMarkdown', () => {
  it('returns empty array on empty input', () => {
    expect(chunkMarkdown('')).toEqual([])
    expect(chunkMarkdown('   \n\n\n')).toEqual([])
  })

  it('keeps small docs as a single chunk with heading path', () => {
    const md = `# Intro\n\nShort body paragraph.`
    const chunks = chunkMarkdown(md)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].headingPath).toEqual(['Intro'])
    expect(chunks[0].content).toContain('Short body paragraph.')
  })

  it('splits on h1/h2 once chunks pass the low-water mark', () => {
    const section = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(60)
    const md = [
      '# Alpha',
      section,
      '',
      '# Beta',
      section,
      '',
      '# Gamma',
      section,
    ].join('\n')
    const chunks = chunkMarkdown(md, { minTokens: 200, maxTokens: 800 })
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    const heads = chunks.map((c) => c.headingPath[0])
    expect(heads).toContain('Alpha')
    expect(heads).toContain('Beta')
    expect(heads).toContain('Gamma')
  })

  it('respects the maxTokens hard cap inside a single section', () => {
    const big = 'x '.repeat(20000)
    const md = `# Big\n\n${big}`
    const chunks = chunkMarkdown(md, { minTokens: 500, maxTokens: 800 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      // +1 per line tolerance
      expect(c.approxTokens).toBeLessThanOrEqual(900)
    }
  })

  it('preserves nested heading path for deeper sections', () => {
    const md = [
      '# Top',
      '## Mid',
      '### Leaf',
      'Body content here.',
    ].join('\n')
    const chunks = chunkMarkdown(md)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].headingPath).toEqual(['Top', 'Mid', 'Leaf'])
  })

  it('stableHash is whitespace-insensitive', () => {
    const a = stableHash('Hello   world')
    const b = stableHash('Hello world')
    const c = stableHash('  Hello world  ')
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('stableHash differs for different content', () => {
    expect(stableHash('foo')).not.toBe(stableHash('bar'))
  })

  it('approximateTokens is monotonic', () => {
    expect(approximateTokens('short')).toBeLessThan(approximateTokens('much longer string here'))
  })

  it('chunks carry stable sourceHash that survives whitespace edits', () => {
    const a = chunkMarkdown('# Title\n\nHello   world')
    const b = chunkMarkdown('# Title\n\nHello world')
    expect(a[0].sourceHash).toBe(b[0].sourceHash)
  })
})
