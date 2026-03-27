// ─── Orchestration Planner ───────────────────────────────────────────────────
// Decomposes natural language queries into phased skill execution plans.

import { getAnthropicClient, PLANNER_MODEL } from '../ai/client'
import { getSkillRegistryReady } from '../skills/registry'
import type { OrchestrationPlan, Phase, PlanStep, Gate } from './types'

export async function decompose(userQuery: string): Promise<OrchestrationPlan> {
  const registry = await getSkillRegistryReady()
  const skillList = registry.getForPlanner()

  const anthropic = getAnthropicClient()

  const systemPrompt = `You are a GTM workflow planner. Decompose the user's request into phased skill execution.

Available skills:
${skillList}

Rules:
- Each phase can have 1+ steps that run in order
- Steps can depend on previous steps (use dependsOnStep with the stepId)
- Add gates between phases when human review is needed
- Gate types: "plan" (review the plan), "data" (review data before next step), "action" (approve before sending)
- Use exact skill IDs from the list above
- Each step needs an input object matching the skill's expected input

Output a JSON object:
{
  "phases": [
    {
      "phaseIndex": 0,
      "description": "Phase description",
      "steps": [
        {
          "stepId": "step-1",
          "skillId": "find-companies",
          "input": { "query": "..." },
          "dependsOnStep": null
        }
      ],
      "gateAfter": { "type": "data", "description": "Review found companies before enrichment" }
    }
  ]
}

Return ONLY the JSON object.`

  const response = await anthropic.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: userQuery }],
    system: systemPrompt,
  })

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')

  let parsed: { phases: Phase[] }
  try {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON found')
    parsed = JSON.parse(match[0])
  } catch (err) {
    throw new Error(`Failed to parse orchestration plan: ${err instanceof Error ? err.message : err}`)
  }

  // Validate all skillIds exist
  for (const phase of parsed.phases) {
    for (const step of phase.steps) {
      const skill = registry.get(step.skillId)
      if (!skill) {
        throw new Error(`Unknown skill "${step.skillId}" in plan. Available: ${registry.list().map(s => s.id).join(', ')}`)
      }
    }
  }

  return {
    query: userQuery,
    phases: parsed.phases,
    createdAt: new Date().toISOString(),
  }
}
