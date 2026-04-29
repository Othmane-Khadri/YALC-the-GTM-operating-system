/**
 * LLM-assisted skill drafter (0.9.F).
 *
 * Replaces the skeletal stub generator that 0.7.0 / 0.8.0 used to seed
 * a new skill body. The wizard collects four primitives — name,
 * description, category, capability — then this module asks the
 * `reasoning` capability to draft a working skill body + output_schema +
 * two example inputs.
 *
 * The drafter is a thin LLM wrapper:
 *   - System prompt describes the markdown-skill format.
 *   - User prompt carries the four primitives + any prior corrections.
 *   - Response must be a JSON object the wizard can hand to the file
 *     writer; we strip code fences before parsing.
 *
 * Tests mock `runSkillDraft` directly to keep the wizard deterministic.
 */

interface SkillDraftInputs {
  name: string
  description: string
  category: string
  capability: string
  /** Free-form corrections from the operator on a re-prompt. */
  corrections?: string
  /** Optional reasoning-call hook injected by tests. */
  reasoningHook?: ReasoningHook
}

export interface SkillDraft {
  /** Inputs declared in the frontmatter. */
  inputs: Array<{ name: string; description: string; required?: boolean }>
  /** JSON Schema object for the skill's output. */
  output_schema: Record<string, unknown>
  /** Markdown body (post-frontmatter) for the skill. */
  body: string
  /** Two example inputs the wizard renders so the user can sanity-check. */
  examples: Array<Record<string, unknown>>
}

export type ReasoningHook = (prompt: string) => Promise<string>

const DRAFT_SYSTEM_PROMPT = `You are a Claude Code skill author. Reply ONLY with a JSON object that matches:
{
  "inputs": [{"name": "...", "description": "...", "required": true}],
  "output_schema": { "type": "object", "required": [...], "properties": {...} },
  "body": "<markdown body that the runtime will substitute {{var}} placeholders into>",
  "examples": [{"<input1>": "..."}, {"<input2>": "..."}]
}

Rules:
- Do not wrap the JSON in code fences.
- Inputs must reference every {{var}} you use in the body.
- output_schema must be a valid JSON Schema (Draft 7-style).
- examples must be two distinct realistic inputs.
- Keep the body under 800 characters.`

/**
 * Build the user prompt sent to the reasoning capability. Public so the
 * test suite can assert its content without round-tripping the network.
 */
export function buildDraftPrompt(args: SkillDraftInputs): string {
  const corrections = args.corrections?.trim()
  return [
    `Skill name: ${args.name}`,
    `Description: ${args.description}`,
    `Category: ${args.category}`,
    `Capability: ${args.capability}`,
    corrections ? `Operator corrections to incorporate: ${corrections}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Strip optional ``` fences and parse JSON. Handles models that wrap
 * their reply in code blocks despite the system prompt asking otherwise.
 */
export function parseDraftResponse(raw: string): SkillDraft {
  const trimmed = raw.trim()
  let text = trimmed
  // Strip leading ``` line + trailing ``` line, with or without language tag.
  text = text.replace(/^```(?:json)?\s*/i, '')
  text = text.replace(/```$/i, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(
      `LLM returned non-JSON draft. Raw response (first 200 chars): ${trimmed.slice(0, 200)}` +
        ` (error: ${err instanceof Error ? err.message : String(err)})`,
    )
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM draft must be a JSON object')
  }
  const obj = parsed as Record<string, unknown>
  const inputs = Array.isArray(obj.inputs) ? (obj.inputs as SkillDraft['inputs']) : []
  const output_schema =
    obj.output_schema && typeof obj.output_schema === 'object'
      ? (obj.output_schema as Record<string, unknown>)
      : {}
  const body = typeof obj.body === 'string' ? obj.body : ''
  const examples = Array.isArray(obj.examples)
    ? (obj.examples as SkillDraft['examples'])
    : []
  if (!body) {
    throw new Error('LLM draft is missing the `body` field')
  }
  if (Object.keys(output_schema).length === 0) {
    throw new Error('LLM draft is missing the `output_schema` field')
  }
  return { inputs, output_schema, body, examples }
}

/** Default reasoning-hook — uses the registered `reasoning` capability. */
async function defaultReasoning(prompt: string): Promise<string> {
  const { getCapabilityRegistryReady } = await import('../providers/capabilities.js')
  const registry = await getCapabilityRegistryReady()
  const { adapter, ctx } = await registry.resolveWithContext('reasoning')
  const result = (await adapter.execute(
    { prompt: `${DRAFT_SYSTEM_PROMPT}\n\n${prompt}` },
    ctx,
  )) as { text?: string }
  if (typeof result?.text !== 'string' || result.text.trim() === '') {
    throw new Error('reasoning capability returned an empty response')
  }
  return result.text
}

/**
 * Run the LLM draft. Returns a parsed `SkillDraft` ready for the wizard
 * to render. Tests inject `reasoningHook` to skip the live network call.
 */
export async function runSkillDraft(args: SkillDraftInputs): Promise<SkillDraft> {
  const prompt = buildDraftPrompt(args)
  const hook = args.reasoningHook ?? defaultReasoning
  const text = await hook(prompt)
  return parseDraftResponse(text)
}

/**
 * Render the final skill markdown file. Public so tests can assert the
 * output shape without going through the inquirer prompts.
 */
export function renderSkillFile(args: {
  name: string
  description: string
  category: string
  capability: string
  draft: SkillDraft
}): string {
  const { name, description, category, capability, draft } = args
  const inputsYaml = draft.inputs
    .map((inp) => {
      const lines = [`  - name: ${inp.name}`, `    description: ${inp.description}`]
      if (inp.required === false) lines.push(`    required: false`)
      return lines.join('\n')
    })
    .join('\n')
  // Safe stringify — the schema is JSON, so we serialize then re-indent
  // into yaml-compatible block-flow. Two-space indent keeps the file diffable.
  const schemaJson = JSON.stringify(draft.output_schema, null, 2)
  const schemaIndented = schemaJson
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n')
  return `---
name: ${name}
description: ${description}
category: ${category}
inputs:
${inputsYaml}
capability: ${capability}
output: structured_json
output_schema:
${schemaIndented}
---

${draft.body.trim()}
`
}
