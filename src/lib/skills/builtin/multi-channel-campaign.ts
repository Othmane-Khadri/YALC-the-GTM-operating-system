import type { Skill, SkillEvent, SkillContext } from '../types'
import { sequenceEngine } from '../../campaign/sequence-engine'
import { buildChannelStates } from '../../campaign/sequence'
import type { SequenceDefinition, LeadSequenceState } from '../../campaign/sequence'
import { validateAndFix, validateMessage } from '../../outbound/validator'
import { rateLimiter } from '../../rate-limiter'
import { unipileService } from '../../services/unipile'
import { instantlyService } from '../../services/instantly'

interface MultiChannelInput {
  sequencePath: string
  leads: Array<{
    id: string
    email?: string
    providerId?: string
    firstName?: string
    lastName?: string
    company?: string
    headline?: string
    linkedinUrl?: string
    [key: string]: unknown
  }>
  linkedinAccountId?: string
  dryRun?: boolean
}

export const multiChannelCampaignSkill: Skill = {
  id: 'multi-channel-campaign',
  name: 'Multi-Channel Campaign',
  version: '1.0.0',
  description:
    'Execute a multi-channel sequence (LinkedIn + email + Twitter) from a YAML definition. Evaluates per-lead conditions, dispatches actions to the right channel, respects rate limits.',
  category: 'outreach',

  inputSchema: {
    type: 'object',
    properties: {
      sequencePath: { type: 'string', description: 'Path to sequence YAML' },
      leads: { type: 'array', items: { type: 'object' }, description: 'Leads to process' },
      linkedinAccountId: { type: 'string', description: 'Unipile LinkedIn account ID' },
      dryRun: { type: 'boolean', description: 'Preview without sending' },
    },
    required: ['sequencePath', 'leads'],
  },

  outputSchema: {
    type: 'object',
    properties: {
      processed: { type: 'number' },
      actions: { type: 'array', items: { type: 'object' } },
    },
  },

  requiredCapabilities: [],

  async *execute(input: unknown, _context: SkillContext): AsyncIterable<SkillEvent> {
    const { sequencePath, leads, linkedinAccountId, dryRun } = input as MultiChannelInput

    // 1. Load sequence
    let sequence: SequenceDefinition
    try {
      sequence = sequenceEngine.loadSequence(sequencePath)
    } catch (err) {
      yield { type: 'error', message: `Failed to load sequence: ${err instanceof Error ? err.message : err}` }
      return
    }

    yield {
      type: 'progress',
      message: `Loaded sequence "${sequence.name}" — ${sequence.steps.length} steps across ${[...new Set(sequence.steps.map(s => s.channel))].join(', ')}`,
      percent: 5,
    }

    // 2. Auto-fix templates against outbound rules (fix, don't block — templates have merge fields)
    for (const step of sequence.steps) {
      if (step.template) {
        const fixed = validateAndFix(step.template)
        if (fixed.fixes.length > 0) {
          step.template = fixed.text
          yield {
            type: 'progress',
            message: `Auto-fixed Day ${step.day} ${step.channel}/${step.action}: ${fixed.fixes.join(', ')}`,
            percent: 3,
          }
        }
      }
    }

    // 3. Process each lead
    const actions: Array<{ leadId: string; day: number; channel: string; action: string; status: string }> = []
    let processed = 0

    // Buffer email sends — Instantly works in bulk. Group by (subject|body) → list of leads.
    type EmailBuf = { subject: string; body: string; leads: Array<{ email: string; first_name?: string; last_name?: string; company_name?: string }>; leadIds: string[] }
    const emailBuffers = new Map<string, EmailBuf>()

    for (const lead of leads) {
      // Build current channel state from lead fields
      const channelStates = buildChannelStates(lead)

      const state: LeadSequenceState = {
        leadId: lead.id,
        sequenceName: sequence.name,
        currentStepIndex: 0,
        startedAt: (lead.createdAt as string) ?? new Date().toISOString(),
        channelStates,
      }

      const daysSinceStart = sequenceEngine.getDaysSinceStart(state.startedAt)
      const nextResult = sequenceEngine.getNextStep(state, sequence, daysSinceStart)

      if (!nextResult) {
        actions.push({
          leadId: lead.id,
          day: daysSinceStart,
          channel: '-',
          action: 'skip',
          status: channelStates.email.replied || channelStates.linkedin.replied ? 'replied' : 'waiting',
        })
        continue
      }

      const nextStep = nextResult.step
      const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email || lead.id
      const message = nextStep.template
        ? nextStep.template
            .replace(/\{\{first_name\}\}/g, lead.firstName ?? '')
            .replace(/\{\{last_name\}\}/g, lead.lastName ?? '')
            .replace(/\{\{company\}\}/g, lead.company ?? '')
            .replace(/\{\{headline\}\}/g, lead.headline ?? '')
        : undefined

      if (dryRun) {
        const condStatus = nextStep.condition
          ? `[condition: ${nextStep.condition} = ${sequenceEngine.evaluateCondition(channelStates, nextStep.condition)}]`
          : ''
        console.log(`[dry-run] ${leadName} → Day ${nextStep.day} ${nextStep.channel}/${nextStep.action} ${condStatus}`)
        if (message) console.log(`[dry-run]   Message: "${message.slice(0, 80)}..."`)
        actions.push({ leadId: lead.id, day: nextStep.day, channel: nextStep.channel, action: nextStep.action, status: 'dry-run' })
        processed++
        continue
      }

      // Dispatch to the right channel
      try {
        let status = 'sent'

        if (nextStep.channel === 'linkedin') {
          if (!linkedinAccountId) {
            console.log(`[multi-channel] Skipping LinkedIn action for ${leadName} — no account ID`)
            actions.push({ leadId: lead.id, day: nextStep.day, channel: 'linkedin', action: nextStep.action, status: 'skipped_no_account' })
            continue
          }
          const providerId = lead.providerId ?? ''

          if (nextStep.action === 'connect') {
            if (!providerId) {
              status = 'skipped_no_provider_id'
            } else if (message && validateMessage(message).violations.some(v => v.severity === 'hard')) {
              status = 'blocked_validator'
            } else if (!await rateLimiter.acquire('linkedin.connect', linkedinAccountId)) {
              status = 'rate_limited'
            } else {
              await unipileService.sendConnection(linkedinAccountId, providerId, message)
            }
          } else if (nextStep.action === 'dm') {
            if (!message) { status = 'skipped_no_template' }
            else if (!providerId) { status = 'skipped_no_provider_id' }
            else if (validateMessage(message).violations.some(v => v.severity === 'hard')) {
              status = 'blocked_validator'
            }
            else if (!await rateLimiter.acquire('linkedin.dm', linkedinAccountId)) {
              status = 'rate_limited'
            } else {
              await unipileService.sendMessage(linkedinAccountId, providerId, message)
            }
          } else if (nextStep.action === 'view_profile') {
            // Profile view — just log, no API call yet
            status = 'logged'
          }
        } else if (nextStep.channel === 'email') {
          if (!lead.email) {
            actions.push({ leadId: lead.id, day: nextStep.day, channel: 'email', action: nextStep.action, status: 'skipped_no_email' })
            continue
          }
          if (!message) {
            status = 'skipped_no_template'
          } else if (!instantlyService.isAvailable()) {
            status = 'instantly_unavailable'
          } else if (validateMessage(message).violations.some(v => v.severity === 'hard')) {
            status = 'blocked_validator'
          } else if (!await rateLimiter.acquire('instantly.send', `seq:${sequence.name}`)) {
            status = 'rate_limited'
          } else {
            // Buffer for bulk flush at end of loop
            const subject = nextStep.subject || nextStep.template?.split('\n')[0]?.slice(0, 80) || sequence.name
            const key = `${subject}::${message}`
            if (!emailBuffers.has(key)) {
              emailBuffers.set(key, { subject, body: message, leads: [], leadIds: [] })
            }
            const buf = emailBuffers.get(key)!
            buf.leads.push({
              email: lead.email!,
              first_name: lead.firstName,
              last_name: lead.lastName,
              company_name: lead.company,
            })
            buf.leadIds.push(lead.id)
            status = 'queued_email'
          }
        } else {
          status = 'channel_not_supported'
        }

        actions.push({ leadId: lead.id, day: nextStep.day, channel: nextStep.channel, action: nextStep.action, status })
        if (status === 'sent' || status === 'logged' || status === 'queued_email') {
          processed++
        }
      } catch (err) {
        console.error(`[multi-channel] Failed ${nextStep.channel}/${nextStep.action} for ${leadName}:`, err)
        actions.push({ leadId: lead.id, day: nextStep.day, channel: nextStep.channel, action: nextStep.action, status: 'error' })
      }
    }

    // 3b. Flush buffered email sends to Instantly (bulk per unique template)
    if (!dryRun && emailBuffers.size > 0 && instantlyService.isAvailable()) {
      // Idempotency: list existing Instantly campaigns once and reuse-by-name where possible.
      let existingCampaigns: Array<{ id: string; name: string; status: string }> = []
      try {
        existingCampaigns = await instantlyService.listCampaigns()
      } catch (err) {
        console.error('[multi-channel] Could not list existing Instantly campaigns:', err)
      }
      for (const [, buf] of emailBuffers) {
        try {
          const campaignName = `${sequence.name} — ${buf.subject}`.slice(0, 120)
          const existing = existingCampaigns.find(c => c.name === campaignName)
          const created = existing ?? await instantlyService.createCampaign({
            name: campaignName,
            sequences: [{ subject: buf.subject, body: buf.body, delay_days: 0 }],
          })
          await instantlyService.addLeadsToCampaign(created.id, buf.leads)
          yield {
            type: 'progress',
            message: `Instantly: created campaign ${created.id} with ${buf.leads.length} leads`,
            percent: 95,
          }
          for (const id of buf.leadIds) {
            const a = actions.find(x => x.leadId === id && x.status === 'queued_email')
            if (a) a.status = 'sent_email'
          }
        } catch (err) {
          console.error('[multi-channel] Failed Instantly bulk flush:', err)
          for (const id of buf.leadIds) {
            const a = actions.find(x => x.leadId === id && x.status === 'queued_email')
            if (a) a.status = 'instantly_error'
          }
        }
      }
    }

    // 4. Summary
    const byChannel = new Map<string, number>()
    const byStatus = new Map<string, number>()
    for (const a of actions) {
      byChannel.set(a.channel, (byChannel.get(a.channel) ?? 0) + 1)
      byStatus.set(a.status, (byStatus.get(a.status) ?? 0) + 1)
    }

    const channelSummary = [...byChannel.entries()].map(([c, n]) => `${c}: ${n}`).join(', ')
    const statusSummary = [...byStatus.entries()].map(([s, n]) => `${s}: ${n}`).join(', ')

    yield {
      type: 'progress',
      message: `Processed ${processed}/${leads.length} leads. Channels: ${channelSummary}. Status: ${statusSummary}`,
      percent: 100,
    }

    if (dryRun) {
      yield { type: 'progress', message: '[dry-run] No actions taken.', percent: 100 }
    }

    yield { type: 'result', data: { processed, total: leads.length, actions } }
  },
}
