/**
 * /api/skills/* — skill catalog + run surface for the SPA's /skills page.
 *
 * Reads bundled skills from the in-process skill registry (which itself
 * loads `configs/skills/*.md` plus user skills from
 * `~/.gtm-os/skills/*.md` at startup).
 *
 * Endpoints:
 *   GET  /api/skills/list      — every registered skill, optional ?category= filter
 *   GET  /api/skills/:name     — one skill's full metadata + body preview
 *   POST /api/skills/run/:name — execute the skill with the supplied inputs
 *
 * `:name` accepts either the registered id (e.g. `find-companies`,
 * `md:detect-news`) or the bare name without the `md:` prefix — the
 * runner already does that fallback.
 */

import { Hono } from 'hono'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PKG_ROOT } from '../../paths.js'

export const skillsRoutes = new Hono()

const VALID_CATEGORIES = new Set([
  'research',
  'content',
  'outreach',
  'analysis',
  'data',
  'integration',
  'qualification',
  'custom',
])

// ─── GET /api/skills/list ───────────────────────────────────────────────────

skillsRoutes.get('/list', async (c) => {
  const category = c.req.query('category')
  const { getSkillRegistryReady } = await import('../../skills/registry.js')
  const registry = await getSkillRegistryReady()
  let skills = registry.list()
  if (category && VALID_CATEGORIES.has(category)) {
    skills = skills.filter((s) => s.category === category)
  }
  return c.json({
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      version: s.version,
      description: s.description,
      category: s.category,
    })),
    total: skills.length,
  })
})

// ─── GET /api/skills/:name ──────────────────────────────────────────────────

skillsRoutes.get('/:name', async (c) => {
  const name = c.req.param('name')
  const { getSkillRegistryReady } = await import('../../skills/registry.js')
  const registry = await getSkillRegistryReady()
  let skill = registry.get(name)
  if (!skill && !name.startsWith('md:')) skill = registry.get(`md:${name}`)
  if (!skill) {
    return c.json({ error: 'unknown_skill', message: `Unknown skill "${name}".` }, 404)
  }
  return c.json({
    id: skill.id,
    name: skill.name,
    version: skill.version,
    description: skill.description,
    category: skill.category,
    inputSchema: skill.inputSchema,
    outputSchema: skill.outputSchema,
    bodyPreview: loadBodyPreview(skill.id),
  })
})

/**
 * Best-effort markdown body preview lookup. Skills registered as
 * `md:<slug>` come from configs/skills/<slug>.md (bundled) or
 * ~/.gtm-os/skills/<slug>.md (user). Strip frontmatter and cap at 4 KB so
 * the SPA can render the body without us shipping the whole file when
 * users have very long skill prompts.
 */
function loadBodyPreview(skillId: string): string | null {
  if (!skillId.startsWith('md:')) return null
  const slug = skillId.slice('md:'.length)
  const candidates = [
    join(PKG_ROOT, 'configs', 'skills', `${slug}.md`),
    join(homedir(), '.gtm-os', 'skills', `${slug}.md`),
  ]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    try {
      const raw = readFileSync(p, 'utf-8').trimStart()
      let body = raw
      if (raw.startsWith('---')) {
        const end = raw.indexOf('\n---', 3)
        if (end !== -1) body = raw.slice(end + 4).trimStart()
      }
      return body.length > 4096 ? body.slice(0, 4096) + '\n…\n' : body
    } catch {
      // try next
    }
  }
  return null
}

// ─── POST /api/skills/run/:name ─────────────────────────────────────────────

skillsRoutes.post('/run/:name', async (c) => {
  const name = c.req.param('name')
  const inputs = (await c.req.json().catch(() => ({}))) as Record<string, unknown>

  const { getSkillRegistryReady } = await import('../../skills/registry.js')
  const registry = await getSkillRegistryReady()
  let skill = registry.get(name)
  if (!skill && !name.startsWith('md:')) skill = registry.get(`md:${name}`)
  if (!skill) {
    return c.json({ error: 'unknown_skill', message: `Unknown skill "${name}".` }, 404)
  }

  // Validate required inputs against the declared schema — same shape the
  // runner uses, but we surface a 400 instead of process.exit(1).
  const schema = (skill.inputSchema ?? {}) as Record<string, unknown>
  const required = (schema.required as string[] | undefined) ?? []
  const missing = required.filter(
    (k) => inputs[k] === undefined || inputs[k] === null || inputs[k] === '',
  )
  if (missing.length > 0) {
    return c.json(
      {
        error: 'missing_inputs',
        message: `Missing required input(s): ${missing.join(', ')}`,
        missing,
      },
      400,
    )
  }

  const { getRegistryReady } = await import('../../providers/registry.js')
  const providers = await getRegistryReady()
  const context = {
    framework: null,
    intelligence: [],
    providers,
    userId: 'default',
  }

  const collected: unknown[] = []
  let errorMessage: string | null = null
  const progress: Array<{ message: string; percent: number }> = []
  try {
    for await (const event of skill.execute(inputs, context as never)) {
      if (event.type === 'progress') {
        progress.push({ message: event.message, percent: event.percent })
      } else if (event.type === 'result') {
        collected.push(event.data)
      } else if (event.type === 'error') {
        errorMessage = event.message
      }
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'skill threw'
  }

  if (errorMessage) {
    return c.json(
      {
        ok: false,
        error: 'skill_error',
        message: errorMessage,
        progress,
      },
      500,
    )
  }

  const output = collected.length === 1 ? collected[0] : collected
  return c.json({ ok: true, output, progress })
})
