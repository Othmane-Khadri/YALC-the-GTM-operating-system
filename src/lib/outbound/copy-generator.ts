// ─── Campaign Copy Generator ─────────────────────────────────────────────────
// Claude-powered message generation with voice guidelines + outbound rules.

import { getAnthropicClient, PLANNER_MODEL } from '../ai/client'
import { getVoiceContext, formatVoicePrompt } from './voice-injector'
import { validateAndFix } from './validator'
import { OUTBOUND_RULES } from './rules'

interface CopyGeneratorInput {
  segmentId?: string
  hypothesis: string
  variantCount: number
  leadContext?: string
}

interface GeneratedVariant {
  name: string
  connectNote: string
  dm1Template: string
  dm2Template: string
}

export async function generateCampaignCopy(input: CopyGeneratorInput): Promise<GeneratedVariant[]> {
  const { segmentId, hypothesis, variantCount, leadContext } = input

  // Load voice context
  const voiceContext = await getVoiceContext(segmentId)
  const voiceBlock = voiceContext ? formatVoicePrompt(voiceContext) : ''

  // Build rules block
  const rulesBlock = OUTBOUND_RULES.map((r) => `- ${r.name} (${r.id})`).join('\n')

  const systemPrompt = `You are a LinkedIn outreach copywriter. Generate ${variantCount} distinct campaign messaging variants.

${voiceBlock}

## Outbound Rules (ALL messages MUST follow these)
${rulesBlock}

## Template Variables
Use these placeholders in messages: {{first_name}}, {{last_name}}, {{company}}, {{headline}}

## Constraints
- Connect note: max 300 characters
- Each variant should test a different messaging angle
- DM1: sent after connection accepted, reference the connect note
- DM2: follow-up if no reply to DM1, add new value or urgency
- CTA must be specific (e.g., "15 minutes next Tuesday" not "let's chat sometime")
- Start greetings with "Hello"
- Never start any message with "I"
- Never use dashes as punctuation

## Output Format
Return a JSON array with exactly ${variantCount} objects:
[{ "name": "Variant Name", "connectNote": "...", "dm1Template": "...", "dm2Template": "..." }]

Return ONLY the JSON array, no markdown code blocks.`

  const userPrompt = `Campaign hypothesis: ${hypothesis}
${leadContext ? `Lead context: ${leadContext}` : ''}

Generate ${variantCount} variants now.`

  const anthropic = getAnthropicClient()
  const response = await anthropic.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 2048,
    messages: [
      { role: 'user', content: userPrompt },
    ],
    system: systemPrompt,
  })

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')

  // Parse JSON response
  let variants: GeneratedVariant[]
  try {
    // Try to extract JSON from the response (handle markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error('No JSON array found in response')
    variants = JSON.parse(jsonMatch[0])
  } catch (err) {
    throw new Error(`Failed to parse Claude response as variant JSON: ${err instanceof Error ? err.message : err}`)
  }

  // Validate and fix each field
  const validated = variants.map((v) => {
    const connectFix = validateAndFix(v.connectNote)
    const dm1Fix = validateAndFix(v.dm1Template)
    const dm2Fix = validateAndFix(v.dm2Template)

    if (connectFix.fixes.length > 0) {
      console.log(`[copy-gen] Auto-fixed "${v.name}" connectNote: ${connectFix.fixes.join(', ')}`)
    }
    if (dm1Fix.fixes.length > 0) {
      console.log(`[copy-gen] Auto-fixed "${v.name}" dm1: ${dm1Fix.fixes.join(', ')}`)
    }
    if (dm2Fix.fixes.length > 0) {
      console.log(`[copy-gen] Auto-fixed "${v.name}" dm2: ${dm2Fix.fixes.join(', ')}`)
    }

    return {
      name: v.name,
      connectNote: connectFix.text,
      dm1Template: dm1Fix.text,
      dm2Template: dm2Fix.text,
    }
  })

  return validated
}
