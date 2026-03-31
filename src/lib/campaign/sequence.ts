// ─── Multi-Channel Sequence Types ───────────────────────────────────────────
// YAML-defined sequences that span LinkedIn, email, Twitter, and phone.

export type SequenceChannel = 'linkedin' | 'email' | 'twitter' | 'phone'

export type SequenceAction =
  | 'view_profile'
  | 'connect'
  | 'dm'
  | 'send'        // email send
  | 'call'
  | 'like'
  | 'comment'
  | 'follow'

export interface SequenceDefinition {
  name: string
  description?: string
  steps: SequenceStep[]
}

export interface SequenceStep {
  day: number
  channel: SequenceChannel
  action: SequenceAction
  template?: string        // Template key or inline content
  subject?: string         // Email subject (email channel only)
  condition?: string       // e.g., "!replied_email AND connected_linkedin"
  metadata?: Record<string, unknown>
}

export interface ChannelStates {
  linkedin: {
    profileViewed: boolean
    connected: boolean
    connectSent: boolean
    dmSent: boolean
    replied: boolean
  }
  email: {
    sent: boolean
    opened: boolean
    replied: boolean
    bounced: boolean
  }
  twitter: {
    followed: boolean
    liked: boolean
    commented: boolean
    replied: boolean
  }
  phone: {
    called: boolean
    connected: boolean
    voicemail: boolean
  }
}

export interface LeadSequenceState {
  leadId: string
  sequenceName: string
  currentStepIndex: number
  startedAt: string
  pausedAt?: string
  completedAt?: string
  channelStates: ChannelStates
}

/**
 * Build channel states from a campaign lead's DB fields.
 */
export function buildChannelStates(lead: Record<string, unknown>): ChannelStates {
  return {
    linkedin: {
      profileViewed: false, // not tracked yet
      connected: !!lead.connectedAt,
      connectSent: !!lead.connectSentAt,
      dmSent: !!lead.dm1SentAt || !!lead.dm2SentAt,
      replied: !!lead.repliedAt,
    },
    email: {
      sent: !!lead.emailSentAt,
      opened: !!lead.emailOpenedAt,
      replied: !!lead.emailRepliedAt,
      bounced: !!lead.emailBouncedAt,
    },
    twitter: {
      followed: false,
      liked: false,
      commented: false,
      replied: false,
    },
    phone: {
      called: false,
      connected: false,
      voicemail: false,
    },
  }
}
