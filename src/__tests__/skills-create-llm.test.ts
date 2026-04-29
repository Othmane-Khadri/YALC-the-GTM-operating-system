import { describe, it, expect } from 'vitest'
import Ajv from 'ajv'

import {
  runSkillDraft,
  parseDraftResponse,
  renderSkillFile,
  buildDraftPrompt,
} from '../lib/skills/llm-draft'

const CANNED_RESPONSE = JSON.stringify({
  inputs: [
    { name: 'topic', description: 'Topic to research', required: true },
    { name: 'depth', description: 'How deep to go', required: false },
  ],
  output_schema: {
    type: 'object',
    required: ['summary'],
    properties: {
      summary: { type: 'string' },
      sources: { type: 'array', items: { type: 'string' } },
    },
  },
  body: 'Research the topic {{topic}} at depth {{depth}}. Return a JSON summary.',
  examples: [
    { topic: 'GTM agents', depth: 'shallow' },
    { topic: 'GTM engineers', depth: 'deep' },
  ],
})

describe('0.9.F LLM-assisted skills:create', () => {
  it('parses the LLM JSON response into a SkillDraft (handles bare JSON)', () => {
    const draft = parseDraftResponse(CANNED_RESPONSE)
    expect(draft.inputs).toHaveLength(2)
    expect(draft.body).toContain('{{topic}}')
    expect(draft.examples).toHaveLength(2)
  })

  it('output_schema is a valid JSON Schema (compiles via Ajv)', () => {
    const draft = parseDraftResponse(CANNED_RESPONSE)
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(draft.output_schema as object)
    expect(typeof validate).toBe('function')
    // Sanity check: a payload matching the schema validates.
    expect(validate({ summary: 'ok', sources: ['https://x.com'] })).toBe(true)
  })

  it('runSkillDraft accepts a corrections re-prompt and threads it into the LLM call', async () => {
    const captured: string[] = []
    const draft = await runSkillDraft({
      name: 'research-x',
      description: 'Research X',
      category: 'research',
      capability: 'reasoning',
      corrections: 'Add a `language` input',
      reasoningHook: async (prompt: string) => {
        captured.push(prompt)
        return CANNED_RESPONSE
      },
    })
    expect(captured).toHaveLength(1)
    expect(captured[0]).toContain('Add a `language` input')
    // Verify buildDraftPrompt is the canonical builder.
    const expectedPrompt = buildDraftPrompt({
      name: 'research-x',
      description: 'Research X',
      category: 'research',
      capability: 'reasoning',
      corrections: 'Add a `language` input',
    })
    expect(captured[0]).toBe(expectedPrompt)
    expect(draft.body).toContain('{{topic}}')
  })

  it('renderSkillFile produces parseable frontmatter that the markdown loader accepts', async () => {
    const draft = parseDraftResponse(CANNED_RESPONSE)
    const md = renderSkillFile({
      name: 'research-x',
      description: 'Research X',
      category: 'research',
      capability: 'reasoning',
      draft,
    })
    expect(md.startsWith('---\nname: research-x\n')).toBe(true)
    expect(md).toContain('capability: reasoning')
    expect(md).toContain('output_schema:')
    expect(md).toContain('{{topic}}')

    // Round-trip through the loader: write to temp dir, load, assert no errors.
    const { tmpdir } = await import('node:os')
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(tmpdir(), `yalc-llm-draft-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'research-x.md')
    writeFileSync(filePath, md)
    try {
      const { loadMarkdownSkill } = await import('../lib/skills/markdown-loader')
      const result = await loadMarkdownSkill(filePath)
      expect(result.errors).toEqual([])
      expect(result.skill).not.toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
