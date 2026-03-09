import { NextRequest } from 'next/server'
import { getAnthropicClient, PLANNER_MODEL } from '@/lib/ai/client'
import type { GTMFramework } from '@/lib/framework/types'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { framework } = await req.json() as { framework: Partial<GTMFramework> }

  if (!framework) {
    return Response.json({ questions: [] })
  }

  try {
    const anthropic = getAnthropicClient()

    // Analyze what's missing
    const gaps: string[] = []
    const c = framework.company
    if (!c?.industry) gaps.push('industry')
    if (!c?.stage || c.stage === 'seed') gaps.push('company stage')
    if (!c?.teamSize) gaps.push('team size')

    const p = framework.positioning
    if (!p?.differentiators?.length) gaps.push('key differentiators')
    if (!p?.competitors?.length) gaps.push('competitors')

    const segs = framework.segments || []
    if (segs.length === 0) gaps.push('ICP segments')
    else {
      const primary = segs.find((s) => s.priority === 'primary')
      if (primary) {
        if (!primary.painPoints?.length) gaps.push('customer pain points')
        if (!primary.targetRoles?.length) gaps.push('target roles/titles')
        if (!primary.voice?.tone) gaps.push('brand voice/tone')
      }
    }

    const sig = framework.signals
    if (!sig?.buyingIntentSignals?.length) gaps.push('buying intent signals')
    if (!sig?.triggerEvents?.length) gaps.push('trigger events')

    const channels = framework.channels
    if (!channels?.active?.length) gaps.push('active GTM channels')

    const response = await anthropic.messages.create({
      model: PLANNER_MODEL,
      max_tokens: 2048,
      tools: [{
        name: 'generate_questions',
        description: 'Generate follow-up questions to fill gaps in the GTM framework',
        input_schema: {
          type: 'object' as const,
          properties: {
            questions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  question: { type: 'string' },
                  field: { type: 'string', description: 'Framework path this fills, e.g. "segments[0].painPoints"' },
                  inputType: { type: 'string', enum: ['text', 'textarea', 'select', 'multi-select'] },
                  options: { type: 'array', items: { type: 'string' } },
                },
                required: ['id', 'question', 'field', 'inputType'],
              },
            },
          },
          required: ['questions'],
        },
      }],
      tool_choice: { type: 'tool' as const, name: 'generate_questions' },
      messages: [{
        role: 'user',
        content: `You are helping a user set up their GTM operating system. Here's their current framework (partially filled):

${JSON.stringify(framework, null, 2)}

The following areas need more information: ${gaps.join(', ')}.

Generate 3-5 high-leverage questions that would fill the most important gaps. Make questions conversational, not robotic. Use select/multi-select when there are natural options. Focus on questions that will have the biggest impact on workflow personalization.`,
      }],
    })

    let questions: Array<Record<string, unknown>> = []
    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name === 'generate_questions') {
        const input = block.input as { questions: Array<Record<string, unknown>> }
        questions = input.questions
        break
      }
    }

    return Response.json({ questions })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate questions'
    return Response.json({ error: message }, { status: 500 })
  }
}
