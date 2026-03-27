// ─── Orchestration Executor ──────────────────────────────────────────────────
// Phase-by-phase execution with gates and data transforms.

import { getSkillRegistryReady } from '../skills/registry'
import { applyTransform } from './transforms'
import type { SkillEvent, SkillContext } from '../skills/types'
import type { OrchestrationPlan, PipelineContext } from './types'

export async function* executePlan(
  plan: OrchestrationPlan,
  context: SkillContext,
): AsyncIterable<SkillEvent> {
  const registry = await getSkillRegistryReady()
  const pipelineContext: PipelineContext = {
    stepResults: new Map(),
    phaseSummaries: [],
  }

  for (const phase of plan.phases) {
    yield {
      type: 'progress',
      message: `Phase ${phase.phaseIndex + 1}: ${phase.description}`,
      percent: Math.round(((phase.phaseIndex) / plan.phases.length) * 100),
    }

    for (const step of phase.steps) {
      const skill = registry.get(step.skillId)
      if (!skill) {
        yield { type: 'error', message: `Skill "${step.skillId}" not found in registry` }
        continue
      }

      // Resolve input from pipeline context
      let resolvedInput = { ...step.input }

      if (step.dependsOnStep) {
        const depOutput = pipelineContext.stepResults.get(step.dependsOnStep)
        if (depOutput) {
          // Find the dependent step's skill ID
          const depStep = plan.phases
            .flatMap((p) => p.steps)
            .find((s) => s.stepId === step.dependsOnStep)

          if (depStep) {
            resolvedInput = applyTransform(
              depStep.skillId,
              step.skillId,
              depOutput,
              resolvedInput,
            )
          }
        }
      }

      yield {
        type: 'progress',
        message: `  Running: ${skill.name} (${step.stepId})`,
        percent: Math.round(((phase.phaseIndex) / plan.phases.length) * 100 + 5),
      }

      let lastResult: unknown = null

      for await (const event of skill.execute(resolvedInput, context)) {
        if (event.type === 'result') {
          lastResult = event.data
        }
        yield event
      }

      pipelineContext.stepResults.set(step.stepId, lastResult)
    }

    pipelineContext.phaseSummaries.push(
      `Phase ${phase.phaseIndex + 1}: ${phase.description} — completed`,
    )

    // Gate after phase
    if (phase.gateAfter) {
      yield {
        type: 'approval_needed',
        title: `Gate: ${phase.gateAfter.type}`,
        description: phase.gateAfter.description,
        payload: {
          phaseIndex: phase.phaseIndex,
          summaries: pipelineContext.phaseSummaries,
        },
      }
    }
  }

  yield {
    type: 'progress',
    message: `Orchestration complete: ${plan.phases.length} phases executed`,
    percent: 100,
  }
}
