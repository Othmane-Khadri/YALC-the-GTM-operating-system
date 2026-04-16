/**
 * Markdown folder adapter — Phase 1 / C2.
 *
 * Bridges a local markdown knowledge base (a folder of markdown files) into
 * a tenant's memory layer. Config lives in
 * `~/.gtm-os/tenants/<slug>/adapters.yaml` with the shape:
 *
 *   adapters:
 *     - id: markdown-folder
 *       enabled: true
 *       base_dir: "/path/to/knowledge-base"
 *       paths:
 *         - "Context.md"
 *         - "02_Areas/Marketing/Brand_Voice/**\/*.md"
 *
 * sync() walks the path allowlist, chunks each markdown file, and
 * upserts the chunks via MemoryStore.upsertNodeBySourceHash. Chunks
 * whose hash matches an existing node are no-ops (the "unchanged"
 * counter). This is how incremental sync preserves access history
 * on files that didn't change.
 *
 * watch() uses chokidar with a 30s debounce so bursts of edits
 * coalesce into a single sync pass. After each batch it triggers
 * dream(tenantId, { incremental: true }) to run the lightweight
 * lifecycle (no index rebuild).
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'
import yaml from 'js-yaml'
import chokidar from 'chokidar'
import { tenantConfigDir } from '../../tenant/index.js'
import { MemoryStore } from '../../memory/store.js'
import { chunkMarkdown } from '../../memory/chunker.js'
import { dream } from '../../memory/dream.js'
import type { ContextAdapter, SyncResult, UnsubscribeFn } from './types.js'

interface MarkdownFolderConfig {
  enabled?: boolean
  base_dir: string
  paths: string[]
}

const DEBOUNCE_MS = 30_000

function loadAdaptersYaml(tenantId: string): MarkdownFolderConfig | null {
  const path = join(tenantConfigDir(tenantId), 'adapters.yaml')
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = yaml.load(raw) as
      | { adapters?: Array<{ id: string } & MarkdownFolderConfig> }
      | null
    const list = parsed?.adapters ?? []
    const entry = list.find((a) => a.id === 'markdown-folder')
    if (!entry) return null
    if (entry.enabled === false) return null
    if (!entry.base_dir || !Array.isArray(entry.paths)) return null
    return { enabled: entry.enabled, base_dir: entry.base_dir, paths: entry.paths }
  } catch {
    return null
  }
}

/**
 * Tiny glob resolver. Supports: `*`, `**`, and literal paths. Returns an
 * absolute list of .md files under base_dir that match any pattern.
 */
function resolvePaths(baseDir: string, patterns: string[]): string[] {
  const results = new Set<string>()
  for (const pattern of patterns) {
    if (!/[*?]/.test(pattern)) {
      // literal path
      const full = resolve(baseDir, pattern)
      if (existsSync(full) && statSync(full).isFile()) results.add(full)
      continue
    }
    // Expand the pattern by walking base_dir and filtering with a regex.
    const regex = globToRegex(pattern)
    walk(baseDir, (absPath) => {
      const rel = relative(baseDir, absPath)
      if (regex.test(rel) && rel.endsWith('.md')) results.add(absPath)
    })
  }
  return Array.from(results).sort()
}

function globToRegex(pattern: string): RegExp {
  // Escape regex specials except * and /, then translate ** / *.
  let re = ''
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // **  → zero or more path segments
        re += '.*'
        i += 2
        if (pattern[i] === '/') i++
      } else {
        // *  → anything but a path separator
        re += '[^/]*'
        i++
      }
    } else if ('.+()^$|{}[]\\'.includes(c)) {
      re += '\\' + c
      i++
    } else {
      re += c
      i++
    }
  }
  return new RegExp('^' + re + '$')
}

function walk(dir: string, visit: (absPath: string) => void): void {
  if (!existsSync(dir)) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const abs = join(dir, name)
    let stat
    try {
      stat = statSync(abs)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      // Skip common noise
      if (name === 'node_modules' || name === '.git') continue
      walk(abs, visit)
    } else if (stat.isFile()) {
      visit(abs)
    }
  }
}

async function syncOnce(tenantId: string, cfg: MarkdownFolderConfig): Promise<SyncResult> {
  const store = new MemoryStore(tenantId)
  const files = resolvePaths(cfg.base_dir, cfg.paths)

  let added = 0
  let unchanged = 0
  for (const file of files) {
    let body: string
    try {
      body = readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    const chunks = chunkMarkdown(body)
    const rel = relative(cfg.base_dir, file)
    for (const chunk of chunks) {
      const sourceRef = `markdown-folder://${rel}#${chunk.headingPath.join('/')}:${chunk.startLine}`
      const result = await store.upsertNodeBySourceHash({
        type: 'document_chunk',
        content: chunk.content,
        sourceType: 'markdown-folder',
        sourceRef,
        sourceHash: chunk.sourceHash,
        metadata: { headingPath: chunk.headingPath, file: rel },
      })
      if (result.inserted) added++
      else unchanged++
    }
  }
  // "removed" and "updated" require a dedicated tombstone pass;
  // current implementation is additive only.
  return { added, updated: 0, removed: 0, unchanged }
}

export const markdownFolderAdapter: ContextAdapter = {
  id: 'markdown-folder',

  isAvailable(tenantId: string): boolean {
    const cfg = loadAdaptersYaml(tenantId)
    if (!cfg) return false
    return existsSync(cfg.base_dir)
  },

  async sync(tenantId: string): Promise<SyncResult> {
    const cfg = loadAdaptersYaml(tenantId)
    if (!cfg) {
      return { added: 0, updated: 0, removed: 0, unchanged: 0 }
    }
    return syncOnce(tenantId, cfg)
  },

  async watch(tenantId: string): Promise<UnsubscribeFn> {
    const cfg = loadAdaptersYaml(tenantId)
    if (!cfg) {
      return () => {}
    }

    // Chokidar supports its own glob syntax but to keep semantics identical
    // to sync() we resolve the file list up front and only watch those.
    const files = resolvePaths(cfg.base_dir, cfg.paths)
    if (files.length === 0) {
      return () => {}
    }

    let timer: NodeJS.Timeout | null = null
    const trigger = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        // eslint-disable-next-line no-console
        console.log(`[markdown-folder][${tenantId}] debounced re-sync starting`)
        try {
          const result = await syncOnce(tenantId, cfg)
          // eslint-disable-next-line no-console
          console.log(
            `[markdown-folder][${tenantId}] synced: +${result.added} unchanged ${result.unchanged}`,
          )
          await dream(tenantId, { incremental: true, offline: true })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          // eslint-disable-next-line no-console
          console.error(`[markdown-folder][${tenantId}] sync error: ${msg}`)
        }
      }, DEBOUNCE_MS)
    }

    const watcher = chokidar.watch(files, { persistent: true, ignoreInitial: true })
    watcher.on('change', trigger)
    watcher.on('add', trigger)
    watcher.on('unlink', trigger)

    return async () => {
      if (timer) clearTimeout(timer)
      await watcher.close()
    }
  },
}
