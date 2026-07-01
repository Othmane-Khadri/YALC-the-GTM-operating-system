/**
 * Fixture: Acme Inc, a five-role committee with synthesized contacts,
 * enrichment results, and copywriting atom outputs.
 *
 * Each message is intentionally lexically distinct, dash-clean, starts
 * with a non-"I" word, and carries at least one digit so the test suite
 * can assert routing, distinctness, dash-scan, and the voice checks.
 */

import type {
  CommitteeRole,
  ResolvedContact,
  RoleMessage,
} from '../../../../../src/lib/committee/buying-committee-mapper'

export const ACME_COMPANY = { name: 'Acme Inc', domain: 'acme.com' }

export const ACME_OFFER = {
  description:
    'A pipeline data layer for B2B sales teams. Reps lose 2 hours a day stitching pipeline data across CRM, sales engagement, and dialer tools. We collapse it to one feed.',
}

export const ACME_FIRST_CONTACT = {
  raw: 'https://www.linkedin.com/in/riley-chen',
  resolved_name: 'Riley Chen',
  resolved_title: 'Head of Sales Ops',
  resolved_seniority: 'Manager' as const,
}

/**
 * Acme committee, generated for this offer + first contact.
 * Shape mirrors what `parseGeneratedRoles` returns for a typical LLM output.
 */
export const ACME_GENERATED_ROLES: CommitteeRole[] = [
  {
    slot: 'Champion',
    title_patterns: ['Head of Sales Ops', 'RevOps Manager', 'Director of Sales Operations'],
    seniority_tier: 'Manager',
    pain_emphasis: 'user-pain story',
  },
  {
    slot: 'EconomicBuyer',
    title_patterns: ['CRO', 'VP Sales'],
    seniority_tier: 'VP+',
    pain_emphasis: 'ROI math with specific dollar impact',
  },
  {
    slot: 'TechnicalBuyer',
    title_patterns: ['VP Engineering', 'Head of Platform', 'Director of Engineering'],
    seniority_tier: 'VP+',
    pain_emphasis: 'integration and technical risk, concrete',
  },
  {
    slot: 'User',
    title_patterns: ['Senior Account Executive', 'Senior SDR'],
    seniority_tier: 'IC',
    pain_emphasis: 'daily friction, concrete',
  },
  {
    slot: 'Blocker',
    title_patterns: ['Head of Procurement', 'Director of Finance'],
    seniority_tier: 'VP+',
    pain_emphasis: 'procurement risk mitigation, concrete',
  },
]

export const ACME_CONTACTS: Record<CommitteeRole['slot'], ResolvedContact> = {
  Champion: {
    first_name: 'Riley',
    last_name: 'Chen',
    title: 'Head of Sales Ops',
    linkedin_url: 'https://www.linkedin.com/in/riley-chen',
    email: 'riley.chen@acme.com',
    email_status: 'verified',
    phone: '+1-415-555-0101',
    phone_missing: false,
  },
  EconomicBuyer: {
    first_name: 'Morgan',
    last_name: 'Patel',
    title: 'CRO',
    linkedin_url: 'https://www.linkedin.com/in/morgan-patel',
    email: 'morgan.patel@acme.com',
    email_status: 'verified',
    phone: null,
    phone_missing: true,
  },
  TechnicalBuyer: {
    first_name: 'Sam',
    last_name: 'Okafor',
    title: 'VP Engineering',
    linkedin_url: 'https://www.linkedin.com/in/sam-okafor',
    email: 'sam.okafor@acme.com',
    email_status: 'verified',
    phone: null,
    phone_missing: true,
  },
  User: {
    first_name: 'Jules',
    last_name: 'Martin',
    title: 'Senior Account Executive',
    linkedin_url: 'https://www.linkedin.com/in/jules-martin',
    email: 'jules.martin@acme.com',
    email_status: 'guessed',
    phone: null,
    phone_missing: true,
  },
  Blocker: {
    first_name: 'Avery',
    last_name: 'Singh',
    title: 'Head of Procurement',
    linkedin_url: 'https://www.linkedin.com/in/avery-singh',
    email: 'avery.singh@acme.com',
    email_status: 'verified',
    phone: null,
    phone_missing: true,
  },
}

export const ACME_MESSAGES: Record<CommitteeRole['slot'], RoleMessage> = {
  Champion: {
    subject: 'Your reps are losing 2 hours a day to tab juggling',
    body: 'Hello Riley, your sales team spends roughly 2 hours a day stitching pipeline data across the CRM, the dialer, and the sales engagement tool. Our pipeline data layer cuts that to 15 minutes. Worth a 15 minute walkthrough next Tuesday?',
  },
  EconomicBuyer: {
    subject: 'Pipeline math for Acme Q3',
    body: 'Hello Morgan, the average CRO we work with pulls back $40,000 per rep per quarter by killing the manual stitching layer. Payback inside 1 quarter on a 12-rep team. Want the model behind the number?',
  },
  TechnicalBuyer: {
    subject: 'Acme integration scope, SOC2 and SSO',
    body: 'Hello Sam, our connector ships with native SSO, SOC2 Type II, and a 4 hour median time to first byte. Standard rollout for a 50-engineer org is 2 sprints. Open to a 30 minute review with your platform team?',
  },
  User: {
    subject: 'The 6 tabs you open before your first call',
    body: 'Hello Jules, most senior AEs open 6 tabs before the first call of the day. We collapse that to 1. The morning back is worth 45 minutes per day. Want to see it on a Tuesday call?',
  },
  Blocker: {
    subject: 'Vendor risk pack for Acme procurement',
    body: 'Hello Avery, our SOC2, DPA, and standard MSA travel together in 1 folder. 90% of procurement teams clear us in under 2 weeks. Want the pack so your team can pre-review before the next vendor cycle?',
  },
}
