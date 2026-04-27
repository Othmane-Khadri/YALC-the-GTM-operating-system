import { describe, it, expect } from 'vitest'
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
  NotionAdapterUnavailableError,
} from '../lib/frameworks/output/notion-adapter'

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

  it('appendRun throws the documented unavailable error', async () => {
    const prev = process.env.NOTION_API_KEY
    process.env.NOTION_API_KEY = 'secret_test'
    try {
      await expect(
        appendRun({ parentPageId: 'abcdefgh' }, { title: '', rows: [], ranAt: '' }),
      ).rejects.toThrow(/not yet implemented in 0.7.0/)
    } finally {
      if (prev !== undefined) process.env.NOTION_API_KEY = prev
      else delete process.env.NOTION_API_KEY
    }
  })
})
