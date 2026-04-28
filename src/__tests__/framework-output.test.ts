import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  escapeHtml,
  renderTemplate,
  defaultDashboardHtml,
  type DashboardRun,
} from '../lib/frameworks/output/dashboard-adapter'
import {
  notionDestinationAvailable,
  validateNotionTarget,
  appendRun,
  renderMarkdownTable,
  NotionAdapterUnavailableError,
} from '../lib/frameworks/output/notion-adapter'

const notionMocks = vi.hoisted(() => ({
  createChildPage: vi.fn(async (_p: string, _t: string, _c?: unknown[]) => ({ id: 'page-mock' })),
}))

vi.mock('../lib/services/notion', () => {
  class MockNotionService {
    isAvailable() {
      return !!process.env.NOTION_API_KEY
    }
    async createChildPage(parentPageId: string, title: string, children?: unknown[]) {
      return notionMocks.createChildPage(parentPageId, title, children)
    }
  }
  return {
    NotionService: MockNotionService,
    notionService: new MockNotionService(),
    __mock: notionMocks,
  }
})

describe('escapeHtml', () => {
  it('escapes core characters', () => {
    expect(escapeHtml('<a href="x">&y</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;y&lt;/a&gt;')
  })
  it('coerces null to empty', () => {
    expect(escapeHtml(null)).toBe('')
  })
  it('coerces undefined to empty', () => {
    expect(escapeHtml(undefined)).toBe('')
  })
})

describe('renderTemplate', () => {
  it('substitutes {{var}} with escaped values', () => {
    const out = renderTemplate('Hello {{name}}!', { name: '<X>' })
    expect(out).toBe('Hello &lt;X&gt;!')
  })

  it('renders {{{raw}}} unescaped', () => {
    const out = renderTemplate('{{{html}}}', { html: '<b>x</b>' })
    expect(out).toBe('<b>x</b>')
  })

  it('iterates over {{#each rows}}', () => {
    const tpl = '{{#each rows}}<li>{{name}}</li>{{/each}}'
    const out = renderTemplate(tpl, { rows: [{ name: 'a' }, { name: 'b' }] })
    expect(out).toBe('<li>a</li><li>b</li>')
  })

  it('renders nothing when each target is missing', () => {
    expect(renderTemplate('{{#each missing}}row{{/each}}', {})).toBe('')
  })
})

describe('defaultDashboardHtml', () => {
  const run: DashboardRun = {
    title: 'Test',
    summary: 'Sum',
    rows: [{ a: 1, b: '<x>' }],
    ranAt: '2026-01-01T00:00:00Z',
  }

  it('renders a table when rows are present', () => {
    const html = defaultDashboardHtml('test-fw', run)
    expect(html).toContain('<title>test-fw</title>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<th>b</th>')
    expect(html).toContain('&lt;x&gt;')
    expect(html).toContain('Sum')
  })

  it('renders a placeholder when no run yet', () => {
    const html = defaultDashboardHtml('test-fw', null)
    expect(html).toContain('No runs yet')
    expect(html).toContain('test-fw')
  })

  it('escapes the framework name in the placeholder', () => {
    const html = defaultDashboardHtml('<bad>', null)
    expect(html).toContain('&lt;bad&gt;')
    expect(html).not.toContain('<bad>')
  })
})

describe('notionDestinationAvailable', () => {
  it('returns false when NOTION_API_KEY is unset', () => {
    const prev = process.env.NOTION_API_KEY
    delete process.env.NOTION_API_KEY
    try {
      expect(notionDestinationAvailable()).toBe(false)
    } finally {
      if (prev) process.env.NOTION_API_KEY = prev
    }
  })

  it('returns true when NOTION_API_KEY is set', () => {
    const prev = process.env.NOTION_API_KEY
    process.env.NOTION_API_KEY = 'secret_test'
    try {
      expect(notionDestinationAvailable()).toBe(true)
    } finally {
      if (prev !== undefined) process.env.NOTION_API_KEY = prev
      else delete process.env.NOTION_API_KEY
    }
  })
})

describe('Notion adapter (0.7.0 stub)', () => {
  it('validateNotionTarget throws when NOTION_API_KEY missing', () => {
    const prev = process.env.NOTION_API_KEY
    delete process.env.NOTION_API_KEY
    try {
      expect(() => validateNotionTarget({ parentPageId: 'abcdefgh' })).toThrow(
        NotionAdapterUnavailableError,
      )
    } finally {
      if (prev) process.env.NOTION_API_KEY = prev
    }
  })

  it('validateNotionTarget rejects short parent ids', () => {
    const prev = process.env.NOTION_API_KEY
    process.env.NOTION_API_KEY = 'secret_test'
    try {
      expect(() => validateNotionTarget({ parentPageId: 'x' })).toThrow(/parentPageId required/)
    } finally {
      if (prev !== undefined) process.env.NOTION_API_KEY = prev
      else delete process.env.NOTION_API_KEY
    }
  })

  it('appendRun throws when NOTION_API_KEY is missing', async () => {
    const prev = process.env.NOTION_API_KEY
    delete process.env.NOTION_API_KEY
    try {
      await expect(
        appendRun({ parentPageId: 'abcdefgh' }, { title: 't', rows: [], ranAt: '2026-01-01T00:00:00Z' }),
      ).rejects.toThrow(NotionAdapterUnavailableError)
    } finally {
      if (prev !== undefined) process.env.NOTION_API_KEY = prev
    }
  })
})

describe('appendRun (mocked NotionService)', () => {
  let prevKey: string | undefined
  let createChildPage: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    prevKey = process.env.NOTION_API_KEY
    process.env.NOTION_API_KEY = 'secret_test_appendrun'
    const mod = (await import('../lib/services/notion')) as unknown as {
      __mock: { createChildPage: ReturnType<typeof vi.fn> }
    }
    createChildPage = mod.__mock.createChildPage
    createChildPage.mockClear()
    createChildPage.mockResolvedValue({ id: 'page-success' })
  })

  it('happy path — calls NotionService.createChildPage with the correct title and returns pageId', async () => {
    const ranAt = '2026-04-28T08:00:00.000Z'
    const res = await appendRun(
      { parentPageId: 'abcdefgh1234' },
      {
        title: 'Funded Companies',
        summary: 'Three new rounds today.',
        rows: [{ company: 'Acme', round: 'Series A' }],
        ranAt,
      },
    )
    expect(res.pageId).toBe('page-success')
    expect(createChildPage).toHaveBeenCalledTimes(1)
    const call = createChildPage.mock.calls[0]
    expect(call[0]).toBe('abcdefgh1234')
    expect(call[1]).toBe(`Funded Companies — ${ranAt}`)
    // Body: should include the summary paragraph + a code block with the table
    const blocks = call[2] as Array<Record<string, unknown>>
    expect(blocks.length).toBeGreaterThanOrEqual(2)
  })

  it('preserves rows order in the markdown table', async () => {
    const rows = [
      { company: 'Alpha' },
      { company: 'Bravo' },
      { company: 'Charlie' },
    ]
    expect(renderMarkdownTable(rows)).toBe(
      '| company |\n| --- |\n| Alpha |\n| Bravo |\n| Charlie |',
    )
    await appendRun(
      { parentPageId: 'pg-test-1234' },
      { title: 'X', rows, ranAt: '2026-04-28T08:00:00Z' },
    )
    const blocks = createChildPage.mock.calls[0][2] as Array<Record<string, unknown>>
    // Find the code block — it carries the rendered markdown table.
    const codeBlock = blocks.find((b) => (b as { type?: string }).type === 'code') as
      | { code: { rich_text: Array<{ text: { content: string } }> } }
      | undefined
    expect(codeBlock).toBeTruthy()
    const md = codeBlock!.code.rich_text[0].text.content
    // Order check: Alpha appears before Bravo, which appears before Charlie.
    const iA = md.indexOf('Alpha')
    const iB = md.indexOf('Bravo')
    const iC = md.indexOf('Charlie')
    expect(iA).toBeGreaterThan(0)
    expect(iA).toBeLessThan(iB)
    expect(iB).toBeLessThan(iC)
  })

  it('title includes ranAt for idempotency across re-runs', async () => {
    const ranAt1 = '2026-04-28T08:00:00.000Z'
    const ranAt2 = '2026-04-29T08:00:00.000Z'
    await appendRun({ parentPageId: 'pg-idem-1234' }, { title: 'X', rows: [], ranAt: ranAt1 })
    await appendRun({ parentPageId: 'pg-idem-1234' }, { title: 'X', rows: [], ranAt: ranAt2 })
    const titles = createChildPage.mock.calls.map((c) => c[1])
    expect(titles[0]).toBe(`X — ${ranAt1}`)
    expect(titles[1]).toBe(`X — ${ranAt2}`)
    expect(titles[0]).not.toBe(titles[1])
  })

  afterEach(() => {
    if (prevKey !== undefined) process.env.NOTION_API_KEY = prevKey
    else delete process.env.NOTION_API_KEY
  })
})
