/**
 * Markdown-aware chunker — Phase 1 / B2.
 *
 * Splits markdown into header-respecting chunks of ~500-800 tokens.
 * Strategy:
 *   1. Parse `#` through `######` headings to build a heading path stack.
 *   2. Accumulate lines into a pending chunk.
 *   3. When a new heading at depth <= 2 is seen and the pending chunk is
 *      above the low-water mark, flush it.
 *   4. When the pending chunk crosses the high-water mark at any line
 *      boundary, flush immediately.
 *   5. Each chunk carries its heading path so retrieve-time reranking
 *      can surface section context alongside the content.
 *
 * Token counting: Claude/GPT tokenizers are heavy to ship. We use a
 * conservative proxy of `chars * 0.28` (tuned against gpt-tokenizer on
 * English markdown — tends to over-count slightly, so chunks land a bit
 * smaller than the target, which is safe for embedding context windows).
 *
 * The stable hash is sha256(`normalized content`) where normalization
 * collapses runs of whitespace to a single space and trims — so
 * whitespace-only edits don't churn node IDs during incremental sync.
 */

import { createHash } from 'node:crypto'

export interface Chunk {
  content: string
  headingPath: string[]
  sourceHash: string
  startLine: number
  endLine: number
  approxTokens: number
}

export interface ChunkOptions {
  /** Low-water mark — don't flush on heading boundaries below this size. */
  minTokens?: number
  /** High-water mark — flush at the next line when we exceed this. */
  maxTokens?: number
}

const DEFAULT_MIN = 500
const DEFAULT_MAX = 800
const CHARS_PER_TOKEN = 0.28 // char -> token ratio proxy

/** Cheap token estimate. Safe to call on every line. */
export function approximateTokens(text: string): number {
  return Math.ceil(text.length * CHARS_PER_TOKEN)
}

/** Stable hash of content, whitespace-normalized. */
export function stableHash(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(normalized).digest('hex')
}

interface PendingChunk {
  lines: string[]
  headingPath: string[]
  startLine: number
  tokens: number
}

function emptyPending(headingPath: string[], startLine: number): PendingChunk {
  return { lines: [], headingPath: [...headingPath], startLine, tokens: 0 }
}

/**
 * Chunk a markdown string into header-respecting pieces.
 * Returns chunks in document order. Empty input returns `[]`.
 */
export function chunkMarkdown(markdown: string, opts: ChunkOptions = {}): Chunk[] {
  const minTokens = opts.minTokens ?? DEFAULT_MIN
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX

  if (!markdown.trim()) return []

  // Pre-split any line that would overflow maxTokens by itself. Splitting is
  // done at word boundaries so we don't carve tokens in half.
  const rawLines = markdown.split(/\r?\n/)
  const lines: string[] = []
  for (const raw of rawLines) {
    if (approximateTokens(raw) <= maxTokens) {
      lines.push(raw)
      continue
    }
    const words = raw.split(/(\s+)/)
    let buf = ''
    for (const w of words) {
      if (approximateTokens(buf + w) > maxTokens && buf.length > 0) {
        lines.push(buf)
        buf = w.trimStart()
      } else {
        buf += w
      }
    }
    if (buf.length > 0) lines.push(buf)
  }

  const chunks: Chunk[] = []

  // Heading stack: headingStack[depth-1] holds the current heading text at that depth.
  const headingStack: string[] = []

  let pending = emptyPending([], 0)

  const flush = (endLine: number) => {
    if (pending.lines.length === 0) return
    const content = pending.lines.join('\n').trim()
    if (!content) {
      pending = emptyPending(headingStack, endLine + 1)
      return
    }
    chunks.push({
      content,
      headingPath: pending.headingPath,
      sourceHash: stableHash(content),
      startLine: pending.startLine,
      endLine,
      approxTokens: pending.tokens,
    })
    pending = emptyPending(headingStack, endLine + 1)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line)

    if (headingMatch) {
      const depth = headingMatch[1].length
      const text = headingMatch[2].trim()

      // Update heading stack: truncate to depth-1, then push this heading.
      headingStack.length = depth - 1
      headingStack[depth - 1] = text

      // Flush on top-level boundaries (h1/h2) if the pending chunk is
      // big enough to stand on its own. Avoids tiny orphan chunks.
      if (depth <= 2 && pending.tokens >= minTokens) {
        flush(i - 1)
      }

      // Always refresh the heading path to reflect the most recent
      // heading seen in this chunk. For empty pending, also reset
      // startLine so the chunk's span begins at the heading.
      pending.headingPath = [...headingStack]
      if (pending.lines.length === 0) {
        pending.startLine = i
      }
    }

    pending.lines.push(line)
    pending.tokens += approximateTokens(line) + 1 // +1 for newline

    // Hard cap: flush immediately if we've crossed maxTokens.
    if (pending.tokens >= maxTokens) {
      flush(i)
    }
  }

  flush(lines.length - 1)
  return chunks
}
