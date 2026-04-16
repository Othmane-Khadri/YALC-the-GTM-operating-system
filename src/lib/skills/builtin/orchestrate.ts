import type { Skill, SkillEvent, SkillContext } from '../types'

export const orchestrateSkill: Skill = {
  id: 'orchestrate',
  name: 'Skill Orchestrator',
  version: '1.0.0',
  description:
    'Routes natural language queries to sub-skills. Decomposes multi-step requests into phased execution with approval gates.',
  category: 'integration',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural language request to decompose' },
      autoApprove: { type: 'boolean', description: 'Skip approval gates', default: false },
    },
    required: ['query'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      phases: { type: 'number' },
      steps: { type: 'number' },
      summaries: { type: 'array', items: { type: 'string' } },
    },
  },
  requiredCapabilities: [],

  async *execute(input: unknown, context: SkillContext): AsyncIterable<SkillEvent> {
    const { query, autoApprove = false } = input as {
      query: string
      autoApprove?: boolean
    }

    yield { type: 'progress', message: 'Decomposing query into execution plan...', percent: 5 }

    const { decompose } = await import('../../orchestrator/planner')
    const plan = await decompose(query)

    const totalSteps = plan.phases.reduce((sum, p) => sum + p.steps.length, 0)

    yield {
      type: 'progress',
      message: `Plan: ${plan.phases.length} phases, ${totalSteps} steps`,
      percent: 15,
    }

    // Show plan for approval
    if (!autoApprove) {
      const planDescription = plan.phases
        .map((p) =>
          `Phase ${p.phaseIndex + 1}: ${p.description}\n` +
          p.steps.map((s) => `  → ${s.skillId}(${JSON.stringify(s.input).slice(0, 80)})`).join('\n') +
          (p.gateAfter ? `\n  [GATE: ${p.gateAfter.description}]` : ''),
        )
        .join('\n\n')

      yield {
        type: 'approval_needed',
        title: 'Execution Plan',
        description: planDescription,
        payload: plan,
      }
    }

    // Execute the plan
    const { executePlan } = await import('../../orchestrator/executor')

    for await (const event of executePlan(plan, context)) {
      // Skip gate events if auto-approve
      if (autoApprove && event.type === 'approval_needed') continue
      yield event
    }

    yield {
      type: 'result',
      data: {
        query,
        phases: plan.phases.length,
        steps: totalSteps,
      },
    }
  },
}
