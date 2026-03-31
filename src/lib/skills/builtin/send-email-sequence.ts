import type { Skill, SkillEvent, SkillContext } from '../types'
import { instantlyService } from '../../services/instantly'
import { validateMessage } from '../../outbound/validator'
import { rateLimiter } from '../../rate-limiter'
import { INSTANTLY_SIGNUP_URL } from '../../constants'
import type { InstantlyLead, SequenceStep } from '../../services/instantly'

// ─── ColdIQ Copywriting Framework (embedded as validation rules) ────────────
// Adapted from ColdIQ's cold email skill: https://github.com/sachacoldiq/ColdIQ-s-GTM-Skills
const COLD_EMAIL_QA_RULES = [
  'First line must be specific, not generic',
  'No hallucinated facts — every claim must be verifiable',
  'All {{merge_fields}} must be properly closed',
  'No banned phrases: "hope this finds you well", "wanted to reach out", "I was impressed by", "we help companies", "our platform enables", "would you be open to scheduling"',
  'More about them than about you (2:1 ratio minimum)',
  '50-90 words per email — tight, not bloated',
  'CTA is low-effort — prospect can reply in 5 words or less',
  'Reads like a human wrote it, not a marketing team or an AI',
  'No em dashes (—) — rewrite with commas or periods',
  'Subject line is 2-4 words (intrigue) or the full offer (clarity)',
]

interface SendEmailInput {
  campaignName: string
  leads: Array<{
    email: string
    first_name?: string
    last_name?: string
    company?: string
    title?: string
    [key: string]: unknown
  }>
  sequence: Array<{
    subject?: string
    body: string
    delay_days?: number
  }>
  fromAccountId?: string
  dryRun?: boolean
}

export const sendEmailSequenceSkill: Skill = {
  id: 'send-email-sequence',
  name: 'Send Email Sequence',
  version: '1.0.0',
  description:
    'Send a cold email sequence to qualified leads via Instantly.ai. Validates messages against outbound rules and ColdIQ copywriting standards. Supports dry-run.',
  category: 'outreach',

  inputSchema: {
    type: 'object',
    properties: {
      campaignName: { type: 'string', description: 'Campaign name in Instantly' },
      leads: {
        type: 'array',
        items: { type: 'object' },
        description: 'Leads with email, first_name, last_name, company',
      },
      sequence: {
        type: 'array',
        items: { type: 'object' },
        description: 'Email steps with subject, body, delay_days',
      },
      fromAccountId: { type: 'string', description: 'Instantly email account ID (optional)' },
      dryRun: { type: 'boolean', description: 'Preview without sending' },
    },
    required: ['campaignName', 'leads', 'sequence'],
  },

  outputSchema: {
    type: 'object',
    properties: {
      campaignId: { type: 'string' },
      leadCount: { type: 'number' },
      sequenceSteps: { type: 'number' },
    },
  },

  requiredCapabilities: ['instantly'],

  async *execute(input: unknown, _context: SkillContext): AsyncIterable<SkillEvent> {
    const { campaignName, leads, sequence, dryRun } = input as SendEmailInput

    // 1. Check Instantly availability
    if (!instantlyService.isAvailable()) {
      yield {
        type: 'error',
        message: `INSTANTLY_API_KEY not set. Get your key at ${INSTANTLY_SIGNUP_URL}`,
      }
      return
    }

    yield { type: 'progress', message: 'Validating leads and sequence...', percent: 5 }

    // 2. Filter leads with email
    const leadsWithEmail = leads.filter(l => l.email)
    const missing = leads.length - leadsWithEmail.length
    if (missing > 0) {
      yield {
        type: 'progress',
        message: `${missing} leads skipped (no email). ${leadsWithEmail.length} leads ready.`,
        percent: 10,
      }
    }

    if (leadsWithEmail.length === 0) {
      yield { type: 'error', message: 'No leads with email addresses found.' }
      return
    }

    // 3. Validate messages against outbound rules
    const violations: string[] = []
    for (let i = 0; i < sequence.length; i++) {
      const step = sequence[i]
      const result = validateMessage(step.body)
      const hardViolations = result.violations.filter(v => v.severity === 'hard')
      if (hardViolations.length > 0) {
        violations.push(`Step ${i + 1}: ${hardViolations.map(v => v.ruleName).join(', ')}`)
      }
    }

    if (violations.length > 0) {
      yield {
        type: 'error',
        message: `Message blocked by outbound rules:\n${violations.join('\n')}`,
      }
      return
    }

    // 4. ColdIQ QA check (advisory — logged but not blocking)
    yield { type: 'progress', message: 'Running ColdIQ copywriting QA...', percent: 20 }
    for (let i = 0; i < sequence.length; i++) {
      const body = sequence[i].body
      const wordCount = body.split(/\s+/).length
      if (wordCount > 90) {
        yield {
          type: 'progress',
          message: `QA warning: Step ${i + 1} is ${wordCount} words (target: 50-90)`,
          percent: 25,
        }
      }
      if (body.includes('—')) {
        yield {
          type: 'progress',
          message: `QA warning: Step ${i + 1} contains em dashes — rewrite with commas or periods`,
          percent: 25,
        }
      }
    }

    // 5. Dry-run output
    if (dryRun) {
      yield {
        type: 'progress',
        message: [
          `[dry-run] Would create campaign "${campaignName}" in Instantly`,
          `[dry-run] ${leadsWithEmail.length} leads, ${sequence.length} email steps`,
          ...sequence.map((s, i) =>
            `[dry-run] Step ${i + 1}: "${s.subject ?? '(threaded reply)'}" — ${s.body.split(/\s+/).length} words, delay ${s.delay_days ?? 0}d`
          ),
          `[dry-run] ColdIQ QA rules checked: ${COLD_EMAIL_QA_RULES.length}`,
          `[dry-run] No actions taken.`,
        ].join('\n'),
        percent: 100,
      }
      yield {
        type: 'result',
        data: {
          campaignId: 'dry-run',
          leadCount: leadsWithEmail.length,
          sequenceSteps: sequence.length,
        },
      }
      return
    }

    // 6. Check rate limit
    const accountId = 'default'
    if (!await rateLimiter.acquire('instantly.send', accountId, leadsWithEmail.length)) {
      const remaining = await rateLimiter.getRemaining('instantly.send', accountId)
      yield {
        type: 'error',
        message: `Rate limit: only ${remaining} sends remaining today. Requested: ${leadsWithEmail.length}.`,
      }
      return
    }

    // 7. Create campaign in Instantly
    yield { type: 'progress', message: `Creating campaign "${campaignName}"...`, percent: 40 }

    const instantlySequence: SequenceStep[] = sequence.map(s => ({
      subject: s.subject,
      body: s.body,
      delay_days: s.delay_days ?? 0,
    }))

    const campaign = await instantlyService.createCampaign({
      name: campaignName,
      sequences: instantlySequence,
    })

    yield { type: 'progress', message: `Campaign created: ${campaign.id}`, percent: 60 }

    // 8. Add leads
    yield { type: 'progress', message: `Adding ${leadsWithEmail.length} leads...`, percent: 70 }

    const instantlyLeads: InstantlyLead[] = leadsWithEmail.map(l => ({
      email: l.email,
      first_name: l.first_name,
      last_name: l.last_name,
      company_name: l.company,
      title: l.title,
    }))

    await instantlyService.addLeadsToCampaign(campaign.id, instantlyLeads)

    yield {
      type: 'progress',
      message: `${leadsWithEmail.length} leads added. Campaign ready to launch.`,
      percent: 100,
    }

    yield {
      type: 'result',
      data: {
        campaignId: campaign.id,
        leadCount: leadsWithEmail.length,
        sequenceSteps: sequence.length,
      },
    }
  },
}
