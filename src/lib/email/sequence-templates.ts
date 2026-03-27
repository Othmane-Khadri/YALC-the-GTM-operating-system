// ─── Email Sequence Templates ────────────────────────────────────────────────

export type SequenceType = 'welcome' | 'lead-nurture' | 're-engagement' | 'onboarding'

export interface EmailTemplate {
  position: number
  purpose: string
  subjectStrategy: string
  lengthRange: { min: number; max: number }
  ctaType: string
  previewTextRule: string
  dayOffset: number
}

export interface SequenceTemplate {
  type: SequenceType
  description: string
  emailCount: { min: number; max: number }
  totalDays: number
  emails: EmailTemplate[]
  globalRules: string[]
}

export const GLOBAL_RULES = [
  'Subject line max 50 characters',
  'Preview text 40-90 characters',
  'One CTA per email — never two',
  'No images in email 1',
  'P.S. line only in email 3 or later',
  'Start greeting with "Hello" (not Hi/Hey/Dear)',
  'Never start a sentence with "I"',
]

export const SEQUENCE_TEMPLATES: Record<SequenceType, SequenceTemplate> = {
  welcome: {
    type: 'welcome',
    description: 'Welcome new subscribers/signups with progressive value delivery',
    emailCount: { min: 5, max: 7 },
    totalDays: 25,
    emails: [
      { position: 1, purpose: 'Welcome + immediate value', subjectStrategy: 'Personal, warm', lengthRange: { min: 100, max: 200 }, ctaType: 'Read/watch resource', previewTextRule: 'Reinforce subject promise', dayOffset: 0 },
      { position: 2, purpose: 'Quick win / actionable tip', subjectStrategy: 'Curiosity gap', lengthRange: { min: 80, max: 150 }, ctaType: 'Try this now', previewTextRule: 'Tease the tip', dayOffset: 2 },
      { position: 3, purpose: 'Social proof / case study', subjectStrategy: 'Name-drop or metric', lengthRange: { min: 150, max: 250 }, ctaType: 'Read full story', previewTextRule: 'Lead with the result', dayOffset: 5 },
      { position: 4, purpose: 'Deep dive into core feature', subjectStrategy: 'How-to or question', lengthRange: { min: 200, max: 300 }, ctaType: 'Start free trial / demo', previewTextRule: 'Feature benefit', dayOffset: 10 },
      { position: 5, purpose: 'Handle top objection', subjectStrategy: 'Address concern directly', lengthRange: { min: 150, max: 250 }, ctaType: 'Specific action', previewTextRule: 'Acknowledgment', dayOffset: 15 },
      { position: 6, purpose: 'Community / next step', subjectStrategy: 'Invitation tone', lengthRange: { min: 100, max: 200 }, ctaType: 'Join / book call', previewTextRule: 'Community benefit', dayOffset: 20 },
      { position: 7, purpose: 'Recap + strong CTA', subjectStrategy: 'Urgency or summary', lengthRange: { min: 100, max: 200 }, ctaType: 'Primary conversion action', previewTextRule: 'Final value recap', dayOffset: 25 },
    ],
    globalRules: GLOBAL_RULES,
  },

  'lead-nurture': {
    type: 'lead-nurture',
    description: 'Nurture leads with alternating value and soft asks, progressive commitment',
    emailCount: { min: 6, max: 8 },
    totalDays: 40,
    emails: [
      { position: 1, purpose: 'Value-first intro', subjectStrategy: 'Relevant insight', lengthRange: { min: 100, max: 200 }, ctaType: 'Read resource', previewTextRule: 'Industry insight tease', dayOffset: 0 },
      { position: 2, purpose: 'Soft ask + value', subjectStrategy: 'Question format', lengthRange: { min: 80, max: 150 }, ctaType: 'Reply with answer', previewTextRule: 'Engagement prompt', dayOffset: 4 },
      { position: 3, purpose: 'Case study / proof', subjectStrategy: 'Result-led', lengthRange: { min: 150, max: 250 }, ctaType: 'Download / read', previewTextRule: 'Metric hook', dayOffset: 10 },
      { position: 4, purpose: 'Framework / methodology', subjectStrategy: 'How we do X', lengthRange: { min: 200, max: 300 }, ctaType: 'Apply framework', previewTextRule: 'Process tease', dayOffset: 16 },
      { position: 5, purpose: 'Comparison / decision help', subjectStrategy: 'Comparison angle', lengthRange: { min: 150, max: 250 }, ctaType: 'See comparison', previewTextRule: 'Decision context', dayOffset: 22 },
      { position: 6, purpose: 'Direct ask', subjectStrategy: 'Time-bound', lengthRange: { min: 100, max: 180 }, ctaType: 'Book call / demo', previewTextRule: 'Value + urgency', dayOffset: 28 },
      { position: 7, purpose: 'Fresh value angle', subjectStrategy: 'New angle', lengthRange: { min: 100, max: 200 }, ctaType: 'Explore resource', previewTextRule: 'New perspective', dayOffset: 34 },
      { position: 8, purpose: 'Break-up + last offer', subjectStrategy: 'Final check-in', lengthRange: { min: 80, max: 150 }, ctaType: 'Reply or unsubscribe', previewTextRule: 'Respectful close', dayOffset: 40 },
    ],
    globalRules: GLOBAL_RULES,
  },

  're-engagement': {
    type: 're-engagement',
    description: 'Win back inactive subscribers with progressive urgency',
    emailCount: { min: 3, max: 4 },
    totalDays: 14,
    emails: [
      { position: 1, purpose: 'Notice their absence', subjectStrategy: 'Personal, miss-you tone', lengthRange: { min: 80, max: 150 }, ctaType: 'Come back CTA', previewTextRule: 'Acknowledge gap', dayOffset: 0 },
      { position: 2, purpose: 'Value reminder + what\'s new', subjectStrategy: 'What you missed', lengthRange: { min: 100, max: 200 }, ctaType: 'See what\'s new', previewTextRule: 'New value tease', dayOffset: 5 },
      { position: 3, purpose: 'Direct ask with incentive', subjectStrategy: 'Special offer', lengthRange: { min: 80, max: 150 }, ctaType: 'Claim offer', previewTextRule: 'Offer details', dayOffset: 10 },
      { position: 4, purpose: 'Break-up email', subjectStrategy: 'Goodbye tone', lengthRange: { min: 60, max: 120 }, ctaType: 'Stay or unsubscribe', previewTextRule: 'Last chance', dayOffset: 14 },
    ],
    globalRules: GLOBAL_RULES,
  },

  onboarding: {
    type: 'onboarding',
    description: 'Step-by-step activation milestones for new users',
    emailCount: { min: 5, max: 7 },
    totalDays: 14,
    emails: [
      { position: 1, purpose: 'Welcome + first action', subjectStrategy: 'Get started', lengthRange: { min: 80, max: 150 }, ctaType: 'Complete step 1', previewTextRule: 'First milestone', dayOffset: 0 },
      { position: 2, purpose: 'Second milestone', subjectStrategy: 'Next step', lengthRange: { min: 80, max: 150 }, ctaType: 'Complete step 2', previewTextRule: 'Progress tease', dayOffset: 1 },
      { position: 3, purpose: 'Key feature discovery', subjectStrategy: 'Did you know', lengthRange: { min: 100, max: 200 }, ctaType: 'Try feature', previewTextRule: 'Feature benefit', dayOffset: 3 },
      { position: 4, purpose: 'Social proof at milestone', subjectStrategy: 'Others like you', lengthRange: { min: 100, max: 200 }, ctaType: 'Continue setup', previewTextRule: 'Peer comparison', dayOffset: 5 },
      { position: 5, purpose: 'Advanced feature', subjectStrategy: 'Level up', lengthRange: { min: 100, max: 200 }, ctaType: 'Enable feature', previewTextRule: 'Power user tease', dayOffset: 8 },
      { position: 6, purpose: 'Integration / team invite', subjectStrategy: 'Multiply value', lengthRange: { min: 80, max: 150 }, ctaType: 'Invite team / connect', previewTextRule: 'Team benefit', dayOffset: 11 },
      { position: 7, purpose: 'Graduation + upgrade', subjectStrategy: 'You\'re ready', lengthRange: { min: 100, max: 200 }, ctaType: 'Upgrade / book call', previewTextRule: 'Achievement unlock', dayOffset: 14 },
    ],
    globalRules: GLOBAL_RULES,
  },
}
