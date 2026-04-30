/**
 * Structured renderers for human-readable preview content.
 *
 * The /setup/review and /today pages used to render raw YAML/JSON in
 * monospace textareas — fast to ship but unfriendly for non-engineers.
 * These helpers parse the content and lay it out as labeled sections so
 * a typical user can scan, understand, and modify their captured context
 * without parsing braces in their head.
 *
 * The textarea-based "edit raw" mode stays available behind a toggle —
 * the tradeoff is "easy to read by default, full power on demand."
 */

import type { JSX, ReactNode } from 'react'
import yaml from 'js-yaml'

const KEY_LABEL_OVERRIDES: Record<string, string> = {
  icp: 'ICP',
  url: 'URL',
  api: 'API',
  llm: 'LLM',
  cta: 'CTA',
  kpi: 'KPI',
  faq: 'FAQ',
  seo: 'SEO',
  ai: 'AI',
}

/** Format a snake_case or camelCase key as a Title Case label. */
export function humanizeKey(key: string): string {
  if (!key) return key
  const lower = key.toLowerCase()
  if (KEY_LABEL_OVERRIDES[lower]) return KEY_LABEL_OVERRIDES[lower]
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const w = word.toLowerCase()
      if (KEY_LABEL_OVERRIDES[w]) return KEY_LABEL_OVERRIDES[w]
      return w.charAt(0).toUpperCase() + w.slice(1)
    })
    .join(' ')
}

/**
 * Render a parsed JSON-shaped value (the result of yaml.load or
 * JSON.parse) as nested labeled sections.
 *
 * Scalars become read-only display text.
 * Arrays of scalars become bullet lists.
 * Arrays of objects become numbered cards.
 * Objects become labeled sections with their children rendered recursively.
 */
export function StructuredValue({ value, depth = 0 }: { value: unknown; depth?: number }): JSX.Element {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">empty</span>
  }
  if (typeof value === 'string') {
    if (value.includes('\n')) {
      return <p className="whitespace-pre-wrap text-sm leading-relaxed">{value}</p>
    }
    return <span className="text-sm">{value}</span>
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="text-sm font-mono">{String(value)}</span>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground italic text-sm">empty list</span>
    }
    const allScalar = value.every(
      (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v),
    )
    if (allScalar) {
      return (
        <ul className="list-disc pl-5 space-y-0.5">
          {value.map((v, i) => (
            <li key={i} className="text-sm">
              <StructuredValue value={v} depth={depth + 1} />
            </li>
          ))}
        </ul>
      )
    }
    return (
      <div className="space-y-3">
        {value.map((v, i) => (
          <div key={i} className="rounded-md border border-border bg-background/40 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Item {i + 1}</p>
            <StructuredValue value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    )
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) {
      return <span className="text-muted-foreground italic text-sm">empty</span>
    }
    return (
      <dl className={depth === 0 ? 'space-y-4' : 'space-y-3'}>
        {entries.map(([key, child]) => {
          const childIsContainer =
            child !== null && typeof child === 'object'
          return (
            <div
              key={key}
              className={
                childIsContainer && depth === 0
                  ? 'space-y-2 pt-2 border-t border-border first:border-t-0 first:pt-0'
                  : 'flex flex-col gap-1'
              }
            >
              <dt
                className={
                  depth === 0
                    ? 'text-sm font-semibold text-foreground'
                    : 'text-xs uppercase tracking-wide text-muted-foreground'
                }
              >
                {humanizeKey(key)}
              </dt>
              <dd className={depth === 0 ? 'pl-1' : 'pl-0'}>
                <StructuredValue value={child} depth={depth + 1} />
              </dd>
            </div>
          )
        })}
      </dl>
    )
  }
  return <span className="text-sm font-mono">{String(value)}</span>
}

/**
 * Try to parse YAML content. Returns the parsed value on success or
 * `{ error }` on failure so the caller can fall back to raw display.
 */
export function tryParseYaml(content: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const parsed = yaml.load(content)
    return { ok: true, value: parsed }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'YAML parse failed',
    }
  }
}

/**
 * Try to parse JSON content. Same shape as tryParseYaml so callers can
 * branch identically.
 */
export function tryParseJson(content: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(content) }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'JSON parse failed',
    }
  }
}

/**
 * Lightweight markdown renderer: headings, paragraphs, unordered + ordered
 * lists, inline code, bold, italic, and links. No raw HTML, no images.
 *
 * The parser walks line-by-line and emits React elements so the output is
 * safe by construction. Sufficient for the markdown sections (`voice/*`,
 * `positioning/*`, `qualification_rules.md`).
 */
export function MarkdownView({ content }: { content: string }): JSX.Element {
  const lines = content.split('\n')
  const blocks: ReactNode[] = []
  let buffer: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let blockCount = 0

  const flushParagraph = () => {
    if (buffer.length === 0) return
    const text = buffer.join(' ').trim()
    if (text) {
      blocks.push(
        <p key={`p-${blockCount++}`} className="text-sm leading-relaxed">
          {renderInline(text)}
        </p>,
      )
    }
    buffer = []
  }

  const flushList = () => {
    if (!listType || buffer.length === 0) return
    const items = buffer.map((line) => line.replace(/^\s*([-*]|\d+\.)\s+/, ''))
    const ListTag = listType
    blocks.push(
      <ListTag
        key={`l-${blockCount++}`}
        className={
          listType === 'ul'
            ? 'list-disc pl-5 space-y-1 text-sm'
            : 'list-decimal pl-5 space-y-1 text-sm'
        }
      >
        {items.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ListTag>,
    )
    buffer = []
    listType = null
  }

  for (const raw of lines) {
    const line = raw

    // Heading
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1].length
      const cls =
        level === 1
          ? 'font-heading text-xl font-semibold mt-4 first:mt-0'
          : level === 2
            ? 'font-heading text-lg font-semibold mt-3 first:mt-0'
            : 'font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground mt-3 first:mt-0'
      const HeadingTag = (level <= 3 ? `h${level}` : 'h4') as 'h1' | 'h2' | 'h3' | 'h4'
      blocks.push(
        <HeadingTag key={`h-${blockCount++}`} className={cls}>
          {renderInline(heading[2])}
        </HeadingTag>,
      )
      continue
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      if (listType !== 'ul') {
        flushParagraph()
        flushList()
        listType = 'ul'
      }
      buffer.push(line)
      continue
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      if (listType !== 'ol') {
        flushParagraph()
        flushList()
        listType = 'ol'
      }
      buffer.push(line)
      continue
    }

    // Blank line — flush
    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    // Continuation (paragraph or list item wrap)
    if (listType) {
      buffer[buffer.length - 1] += ' ' + line.trim()
    } else {
      buffer.push(line.trim())
    }
  }

  flushParagraph()
  flushList()

  if (blocks.length === 0) {
    return <p className="text-muted-foreground italic text-sm">empty</p>
  }
  return <div className="space-y-3">{blocks}</div>
}

/** Render inline markdown: **bold**, *italic*, `code`, [link](url). */
function renderInline(text: string): ReactNode {
  // Walk the string with a single regex that matches any inline marker.
  // Surrounding text is emitted as plain strings; matched markers as
  // styled spans / anchors / code.
  const tokens: ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      tokens.push(text.slice(last, match.index))
    }
    if (match[2] !== undefined) {
      tokens.push(<strong key={key++}>{match[2]}</strong>)
    } else if (match[3] !== undefined) {
      tokens.push(<em key={key++}>{match[3]}</em>)
    } else if (match[4] !== undefined) {
      tokens.push(
        <code key={key++} className="font-mono text-xs px-1 py-0.5 rounded bg-background border border-border">
          {match[4]}
        </code>,
      )
    } else if (match[5] !== undefined) {
      tokens.push(
        <a key={key++} href={match[6]} target="_blank" rel="noopener noreferrer" className="underline text-primary">
          {match[5]}
        </a>,
      )
    }
    last = re.lastIndex
  }
  if (last < text.length) tokens.push(text.slice(last))
  return tokens
}
