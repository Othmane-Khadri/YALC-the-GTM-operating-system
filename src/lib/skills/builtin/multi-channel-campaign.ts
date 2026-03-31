import type { Skill, SkillEvent, SkillContext } from '../types'
import { sequenceEngine } from '../../campaign/sequence-engine'
import { buildChannelStates } from '../../campaign/sequence'
import type { SequenceDefinition, LeadSequenceState } from '../../campaign/sequence'
import { validateAndFix } from '../../outbound/validator'
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
      const nextStep = sequenceEngine.getNextStep(state, sequence, daysSinceStart)

      if (!nextStep) {
        actions.push({
          leadId: lead.id,
          day: daysSinceStart,
          channel: '-',
          action: 'skip',
          status: channelStates.email.replied || channelStates.linkedin.replied ? 'replied' : 'waiting',
        })
        continue
      }

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
            if (!await rateLimiter.acquire('linkedin.connect', linkedinAccountId)) {
              status = 'rate_limited'
            } else {
              await unipileService.sendConnection(linkedinAccountId, providerId, message)
            }
          } else if (nextStep.action === 'dm') {
            if (!message) { status = 'skipped_no_template'; }
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
          if (!await rateLimiter.acquire('instantly.send', 'default')) {
            status = 'rate_limited'
          } else if (!message) {
            status = 'skipped_no_template'
          } else {
            // For email sends, we'd add to an Instantly campaign
            // In practice this is batched — here we log the intent
            status = 'queued_email'
          }
        } else {
          status = 'channel_not_supported'
        }

        actions.push({ leadId: lead.id, day: nextStep.day, channel: nextStep.channel, action: nextStep.action, status })
        processed++
      } catch (err) {
        console.error(`[multi-channel] Failed ${nextStep.channel}/${nextStep.action} for ${leadName}:`, err)
        actions.push({ leadId: lead.id, day: nextStep.day, channel: nextStep.channel, action: nextStep.action, status: 'error' })
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
