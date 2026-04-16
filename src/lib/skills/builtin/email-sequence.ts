import type { Skill, SkillEvent, SkillContext } from '../types'

export const emailSequenceSkill: Skill = {
  id: 'email-sequence',
  name: 'Email Sequence Generator',
  version: '1.0.0',
  description:
    'Generate template-based email drip sequences. 4 types: Welcome, Lead Nurture, Re-Engagement, Onboarding. Uses brand voice and validates against outbound rules.',
  category: 'content',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['welcome', 'lead-nurture', 're-engagement', 'onboarding'],
        description: 'Sequence type',
      },
      segmentId: { type: 'string', description: 'ICP segment ID for voice targeting' },
      productContext: { type: 'string', description: 'Product/service description' },
      audienceContext: { type: 'string', description: 'Target audience description' },
    },
    required: ['type', 'productContext', 'audienceContext'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string' },
      emails: { type: 'array', items: { type: 'object' } },
      cadence: { type: 'string' },
    },
  },
  requiredCapabilities: [],

  async *execute(input: unknown, _context: SkillContext): AsyncIterable<SkillEvent> {
    const { type, segmentId, productContext, audienceContext } = input as {
      type: 'welcome' | 'lead-nurture' | 're-engagement' | 'onboarding'
      segmentId?: string
      productContext: string
      audienceContext: string
    }

    yield { type: 'progress', message: `Generating ${type} email sequence...`, percent: 10 }

    const { generateSequence } = await import('../../email/sequence-generator')

    const sequence = await generateSequence({
      type,
      segmentId,
      productContext,
      audienceContext,
    })

    yield {
      type: 'progress',
      message: `Generated ${sequence.emails.length} emails. Cadence: ${sequence.cadence}`,
      percent: 90,
    }

    // Print summary
    for (const email of sequence.emails) {
      console.log(`\n  Email ${email.position} (Day ${email.dayOffset}): ${email.purpose}`)
      console.log(`    Subject: ${email.subject}`)
      console.log(`    Preview: ${email.previewText}`)
      console.log(`    CTA: ${email.ctaText}`)
      console.log(`    Words: ${email.wordCount}`)
    }

    yield { type: 'result', data: sequence }
    yield { type: 'progress', message: 'Email sequence complete.', percent: 100 }
  },
}
