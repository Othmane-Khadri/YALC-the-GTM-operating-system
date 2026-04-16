// ─── Email Sequence Generator ────────────────────────────────────────────────
// Claude-powered generation with templates + voice + outbound rules.

import { getAnthropicClient, PLANNER_MODEL } from '../ai/client'
import { getVoiceContext, formatVoicePrompt } from '../outbound/voice-injector'
import { validateAndFix } from '../outbound/validator'
import { SEQUENCE_TEMPLATES, GLOBAL_RULES, type SequenceType } from './sequence-templates'

export interface GeneratedEmail {
  position: number
  purpose: string
  subject: string
  previewText: string
  body: string
  ctaText: string
  ctaUrl: string
  dayOffset: number
  wordCount: number
}

export interface GeneratedSequence {
  type: SequenceType
  emails: GeneratedEmail[]
  cadence: string
}

export async function generateSequence(input: {
  type: SequenceType
  segmentId?: string
  productContext: string
  audienceContext: string
}): Promise<GeneratedSequence> {
  const { type, segmentId, productContext, audienceContext } = input

  const template = SEQUENCE_TEMPLATES[type]
  if (!template) throw new Error(`Unknown sequence type: ${type}`)

  // Load voice
  const voiceContext = await getVoiceContext(segmentId)
  const voiceBlock = voiceContext ? formatVoicePrompt(voiceContext) : ''

  const structureBlock = template.emails
    .map(
      (e) =>
        `Email ${e.position} (Day ${e.dayOffset}): ${e.purpose}\n  Subject strategy: ${e.subjectStrategy}\n  Length: ${e.lengthRange.min}-${e.lengthRange.max} words\n  CTA type: ${e.ctaType}\n  Preview text: ${e.previewTextRule}`,
    )
    .join('\n\n')

  const systemPrompt = `You are an email copywriter creating a ${type} email sequence.

${voiceBlock}

## Global Rules
${GLOBAL_RULES.map((r) => `- ${r}`).join('\n')}

## Sequence Structure
${structureBlock}

## Product Context
${productContext}

## Audience
${audienceContext}

## Output
Generate exactly ${template.emails.length} emails. Return a JSON array:
[{
  "position": 1,
  "subject": "...",
  "previewText": "...",
  "body": "...",
  "ctaText": "...",
  "ctaUrl": "{{cta_url}}"
}]

Rules for each email:
- Subject max 50 chars
- Preview text 40-90 chars
- Body within the word count range
- One clear CTA
- No images in email 1
- P.S. only in email 3+
- Start greetings with "Hello"

Return ONLY the JSON array.`

  const anthropic = getAnthropicClient()
  const response = await anthropic.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: `Generate the ${type} email sequence now.` }],
    system: systemPrompt,
  })

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')

  let emails: Array<{
    position: number
    subject: string
    previewText: string
    body: string
    ctaText: string
    ctaUrl: string
  }>

  try {
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('No JSON array found')
    emails = JSON.parse(match[0])
  } catch (err) {
    throw new Error(`Failed to parse sequence JSON: ${err instanceof Error ? err.message : err}`)
  }

  // Validate and map
  const generated: GeneratedEmail[] = emails.map((email, i) => {
    const templateEmail = template.emails[i] ?? template.emails[template.emails.length - 1]

    // Validate body
    const fixResult = validateAndFix(email.body)
    if (fixResult.fixes.length > 0) {
      console.log(`[email-gen] Email ${email.position} auto-fixed: ${fixResult.fixes.join(', ')}`)
    }

    return {
      position: email.position,
      purpose: templateEmail.purpose,
      subject: email.subject.slice(0, 50),
      previewText: email.previewText.slice(0, 90),
      body: fixResult.text,
      ctaText: email.ctaText,
      ctaUrl: email.ctaUrl,
      dayOffset: templateEmail.dayOffset,
      wordCount: fixResult.text.split(/\s+/).length,
    }
  })

  // Build cadence string
  const dayOffsets = generated.map((e) => e.dayOffset)
  const cadence = dayOffsets
    .map((d, i) => (i === 0 ? `Day ${d}` : `+${d - dayOffsets[i - 1]}d`))
    .join(' → ')

  return { type, emails: generated, cadence }
}
