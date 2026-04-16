import { getAnthropicClient, PLANNER_MODEL } from '../ai/client'
import { updateFramework } from '../framework/context'
import type { GTMFramework } from '../framework/types'

export interface GTMGoals {
  primaryGoal: string
  channels: string[]
  targetVolume: number
  campaignStyle: 'high-touch' | 'volume' | 'test-and-learn'
}

export async function setGoals(framework: GTMFramework): Promise<GTMGoals> {
  console.log('[configure] Setting GTM goals...')

  const anthropic = getAnthropicClient()

  const response = await anthropic.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 1024,
    tools: [{
      name: 'set_gtm_goals',
      description: 'Set GTM goals based on framework analysis',
      input_schema: {
        type: 'object' as const,
        properties: {
          primaryGoal: { type: 'string', description: 'Primary GTM goal (e.g., "Generate 50 qualified leads/month")' },
          channels: { type: 'array', items: { type: 'string' }, description: 'Recommended channels' },
          targetVolume: { type: 'number', description: 'Target monthly lead volume' },
          campaignStyle: { type: 'string', enum: ['high-touch', 'volume', 'test-and-learn'] },
        },
        required: ['primaryGoal', 'channels', 'targetVolume', 'campaignStyle'],
      },
    }],
    tool_choice: { type: 'tool' as const, name: 'set_gtm_goals' },
    messages: [{
      role: 'user',
      content: `Based on this GTM framework, recommend goals:\n\nCompany: ${framework.company.name} (${framework.company.industry})\nStage: ${framework.company.stage}\nValue Prop: ${framework.positioning.valueProp}\nSegments: ${framework.segments.map(s => s.name).join(', ')}\nActive Channels: ${framework.channels.active.join(', ')}\n\nRecommend a primaryGoal, channels (ordered by priority), targetVolume (monthly leads), and campaignStyle.`,
    }],
  })

  let goals: GTMGoals = {
    primaryGoal: 'Generate qualified leads',
    channels: ['linkedin'],
    targetVolume: 50,
    campaignStyle: 'test-and-learn',
  }

  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'set_gtm_goals') {
      goals = block.input as GTMGoals
    }
  }

  // Save goals into framework
  await updateFramework({
    channels: {
      ...framework.channels,
      active: goals.channels as GTMFramework['channels']['active'],
    },
  })

  console.log('\n── GTM Goals ──')
  console.log(`Primary Goal:    ${goals.primaryGoal}`)
  console.log(`Channels:        ${goals.channels.join(', ')}`)
  console.log(`Target Volume:   ${goals.targetVolume}/month`)
  console.log(`Campaign Style:  ${goals.campaignStyle}`)

  return goals
}
