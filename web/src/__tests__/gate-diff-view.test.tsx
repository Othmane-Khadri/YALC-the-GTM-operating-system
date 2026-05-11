/**
 * Tests for D3 — GateDiffView component.
 *
 * Pure helpers (`computeJsonDiff`) are tested independently so logic
 * can be exercised without a DOM. The component itself is rendered via
 * `react-dom/server` so HTML-shape assertions match the rest of the
 * SPA's test suite.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  GateDiffView,
  computeJsonDiff,
  shouldShowViewEditsLink,
  type DiffEntry,
} from '../components/gates/GateDiffView'

describe('computeJsonDiff', () => {
  it('flags pure additions as "added"', () => {
    const diff = computeJsonDiff({ a: 1 }, { a: 1, b: 2 })
    const byKey = new Map(diff.map((d) => [d.key, d]))
    expect(byKey.get('a')?.kind).toBe('unchanged')
    expect(byKey.get('b')?.kind).toBe('added')
    expect(byKey.get('b')?.finalValue).toBe(2)
  })

  it('flags pure removals as "removed"', () => {
    const diff = computeJsonDiff({ a: 1, b: 2 }, { a: 1 })
    const byKey = new Map(diff.map((d) => [d.key, d]))
    expect(byKey.get('b')?.kind).toBe('removed')
    expect(byKey.get('b')?.originalValue).toBe(2)
  })

  it('flags value changes as "changed" with both values', () => {
    const diff = computeJsonDiff({ tone: 'casual' }, { tone: 'formal' })
    const tone = diff.find((d) => d.key === 'tone')
    expect(tone?.kind).toBe('changed')
    expect(tone?.originalValue).toBe('casual')
    expect(tone?.finalValue).toBe('formal')
  })

  it('handles non-object payloads by surfacing a single root entry', () => {
    const diff = computeJsonDiff('hello', 'howdy')
    expect(diff).toHaveLength(1)
    expect(diff[0].kind).toBe('changed')
    expect(diff[0].key).toBe('(value)')
  })

  it('returns no entries when both payloads deep-equal', () => {
    const diff = computeJsonDiff({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })
    expect(diff.every((d) => d.kind === 'unchanged')).toBe(true)
  })
})

describe('GateDiffView', () => {
  it('renders adds with the high-confidence (green) class', () => {
    const html = renderToStaticMarkup(
      <GateDiffView original={{ a: 1 }} final={{ a: 1, b: 2 }} />,
    )
    expect(html).toContain('confidence-high')
    expect(html).toContain('&quot;b&quot;')
  })

  it('renders removes with the low-confidence (red) class', () => {
    const html = renderToStaticMarkup(
      <GateDiffView original={{ a: 1, gone: true }} final={{ a: 1 }} />,
    )
    expect(html).toContain('confidence-low')
    expect(html).toContain('&quot;gone&quot;')
  })

  it('renders changes with the medium-confidence (yellow) class and both values', () => {
    const html = renderToStaticMarkup(
      <GateDiffView original={{ tone: 'casual' }} final={{ tone: 'formal' }} />,
    )
    expect(html).toContain('confidence-medium')
    expect(html).toContain('casual')
    expect(html).toContain('formal')
  })

  it('renders an "identical" empty-state when there are no edits', () => {
    const html = renderToStaticMarkup(
      <GateDiffView original={{ a: 1 }} final={{ a: 1 }} />,
    )
    expect(html.toLowerCase()).toContain('identical')
  })

  it('renders side-by-side columns labelled Original and Final', () => {
    const html = renderToStaticMarkup(
      <GateDiffView original={{ a: 1 }} final={{ a: 2 }} />,
    )
    expect(html).toContain('Original')
    expect(html).toContain('Final')
  })

  it('exposes a stable test hook attribute on the root', () => {
    const html = renderToStaticMarkup(
      <GateDiffView original={{ a: 1 }} final={{ a: 2 }} />,
    )
    expect(html).toContain('data-testid="gate-diff-view"')
  })

  it('typed DiffEntry export covers all four kinds', () => {
    const kinds: DiffEntry['kind'][] = ['added', 'removed', 'changed', 'unchanged']
    expect(kinds.length).toBe(4)
  })
})

describe('shouldShowViewEditsLink', () => {
  it('hides the link when the draft equals the original payload (no edits)', () => {
    const original = { greeting: 'hello', count: 1 }
    const draft = JSON.stringify(original, null, 2)
    expect(shouldShowViewEditsLink(original, draft)).toBe(false)
  })

  it('shows the link when the draft has changed a value', () => {
    const original = { greeting: 'hello' }
    const draft = JSON.stringify({ greeting: 'howdy' }, null, 2)
    expect(shouldShowViewEditsLink(original, draft)).toBe(true)
  })

  it('shows the link when the draft adds a key', () => {
    const original = { greeting: 'hello' }
    const draft = JSON.stringify({ greeting: 'hello', tone: 'casual' }, null, 2)
    expect(shouldShowViewEditsLink(original, draft)).toBe(true)
  })

  it('hides the link when the draft is empty or whitespace', () => {
    expect(shouldShowViewEditsLink({ a: 1 }, '')).toBe(false)
    expect(shouldShowViewEditsLink({ a: 1 }, '   ')).toBe(false)
  })

  it('hides the link when the draft is not valid JSON', () => {
    expect(shouldShowViewEditsLink({ a: 1 }, '{ unparseable')).toBe(false)
  })

  it('treats key-order-independent objects as equal', () => {
    const original = { a: 1, b: 2 }
    const draft = JSON.stringify({ b: 2, a: 1 }, null, 2)
    expect(shouldShowViewEditsLink(original, draft)).toBe(false)
  })
})
