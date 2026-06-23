/**
 * Shared types for the lemlist-campaign-from-icp TypeScript facade.
 *
 * The facade walks the 25-stage chain defined in
 * `.claude/skills/lemlist-campaign-from-icp/SKILL.md`, calling LLM atoms for
 * the pure-prompt stages and Lemlist MCP tools for the side-effecting stages.
 * All MCP and LLM calls are injectable so the chain can be exercised end to
 * end without a live Lemlist account, an Anthropic key, or a real network.
 */

export interface LemlistCampaignFromIcpBrief {
  /** Natural-language ICP description from the operator. */
  icp: string
  /** Outbound channels. v1 is email-only; non-email entries surface as a warning. */
  channels: string[]
  /** Sequence step count, default 3. */
  steps: number
  /** Optional override; derived from the ICP if absent. */
  campaignTitle?: string
  /** Lead ceiling; default 50, max 100. */
  leadCap?: number
  /** Sender email shown in the dryrun preview. */
  senderEmail?: string
  /** Optional time zone for the Lemlist `create_campaign_with_sequence` call. */
  timezone?: string
}

export interface DryrunSequenceStep {
  step: number
  channel: 'email' | 'linkedin'
  delayDays: number
  subject?: string
  body: string
}

export interface DryrunPersona {
  titlePattern: string
  seniorityTier: 'VP+' | 'Manager' | 'IC'
  routedSequenceSkill: string
}

export interface DryrunLead {
  email: string | null
  firstName: string
  lastName?: string
  linkedinUrl?: string
  companyName?: string
  headline?: string
  country?: string
  angle?: string
  personaTier: 'VP+' | 'Manager' | 'IC'
}

/**
 * Dryrun payload passed to the approval callback and persisted under
 * `~/.gtm-os/lemlist-campaign-from-icp/dryrun-{timestamp}.json`.
 *
 * The shape is the load-bearing contract for the Slack handler's Block Kit
 * preview, so additive changes only.
 */
export interface DryrunPayload {
  runId: string
  campaignTitle: string
  senderEmail: string
  audienceCount: number
  emailCoveragePercent: number
  personas: DryrunPersona[]
  leads: DryrunLead[]
  sequence: DryrunSequenceStep[]
  copyScore: number | null
  leadCap: number
  estimatedLemlistCredits: { sourcing: number; enrichment: number }
  dryrunFilePath: string
  /**
   * Audit field: per-tier step bodies. Tier keys are 'VP+', 'Manager', 'IC'.
   * Each entry holds the post-rail sequence steps for that tier. Empty buckets
   * are absent. The Slack preview keeps showing the dominant tier; this field
   * lets reviewers audit copy across every non-empty bucket.
   */
  per_persona_bodies?: Partial<Record<'VP+' | 'Manager' | 'IC', DryrunSequenceStep[]>>
  /**
   * Audit field: true when only one persona bucket received leads, so the
   * facade degrades to its pre-extension single-sequence behaviour.
   */
  single_persona_fallback?: boolean
  /** Per-tier lead counts; populated when per_persona_bodies is set. */
  personaBucketCounts?: Partial<Record<'VP+' | 'Manager' | 'IC', number>>
}

export interface LemlistCampaignFromIcpInput {
  brief: LemlistCampaignFromIcpBrief
  tenantId?: string
  /**
   * Pre-sourced leads to inject (e.g. closed-won lookalikes already enriched
   * via FullEnrich). When provided and non-empty, the facade SKIPS its internal
   * Lemlist people-database sourcing (`runSourcingShape` + `runSearch`) and
   * builds the campaign from THESE leads instead. When absent, the facade
   * sources from Lemlist as before.
   */
  leads?: LemlistSearchLead[]
  approveCallback: (preview: DryrunPayload) => Promise<boolean>
  lemlistClient: LemlistMcpClient
  llm: LlmClient
  /** Filesystem seam for tests; defaults to writing the dryrun JSON to disk. */
  writeDryrunJson?: (path: string, payload: DryrunPayload) => Promise<void>
  /** Time seam for tests. */
  now?: () => Date
  /** Logger seam. */
  log?: (line: string) => void
}

export interface LemlistCampaignResult {
  ok: boolean
  state: 'shipped' | 'rejected' | 'timeout' | 'failed'
  campaignId?: string
  campaignUrl?: string
  errorReason?: string
  dryrunFilePath?: string
}

// ── MCP client surface ──────────────────────────────────────────────────────

export interface LemlistSearchLead {
  full_name: string
  potential_email?: string | null
  lead_linkedin_url?: string
  current_exp_company_name?: string
  country?: string
  headline?: string
  seniority?: string
}

export interface LemlistMcpClient {
  /**
   * `get_lemleads_filters` returns the active filter registry. Tests can stub
   * a minimal subset; production reads from the file path the MCP host hands
   * back when the payload exceeds the LLM context limit.
   */
  getLemleadsFilters: () => Promise<{ filters: Array<{ filterId: string; values?: unknown[] }> }>
  /** `lemleads_search` returns deduped people-database hits. */
  lemleadsSearch: (input: {
    mode: 'people' | 'companies'
    filters: Array<{ filterId: string; in?: unknown[]; out?: unknown[] }>
    size: number
    excludes?: string[]
  }) => Promise<{ leads: LemlistSearchLead[] }>
  createCampaignWithSequence: (input: {
    name: string
    subject: string
    body: string
    timezone: string
  }) => Promise<{ campaignId: string; sequenceId: string }>
  addSequenceStep: (input: {
    campaignId: string
    sequenceId: string
    type: 'email'
    delay: number
    delayType: 'within'
    message: string
    subject?: string
    userConfirmed: true
  }) => Promise<{ ok: true }>
  addLeadToCampaign: (input: {
    campaignId: string
    email: string | null
    firstName: string
    lastName?: string
    linkedinUrl?: string
    companyName?: string
    customVariables?: Record<string, string | undefined>
    deduplicate: true
  }) => Promise<{ ok: true }>
  validateCampaignReadiness: (input: { campaignId: string }) => Promise<{
    ready: boolean
    errors: string[]
  }>
  /**
   * Present for completeness; the facade NEVER calls this with `start`.
   * Tests assert this contract via a spy on the client.
   */
  setCampaignState?: (input: { campaignId: string; action: string }) => Promise<unknown>
}

// ── LLM seam ────────────────────────────────────────────────────────────────

export type LlmAtomName =
  | 'icp-definer'
  | 'persona-definer'
  | 'pain-identifier'
  | 'value-prop-lister'
  | 'offer-definer'
  | 'competitor-finder'
  | 'trigger-finder'
  | 'company-finder'
  | 'list-builder'
  | 'people-finder'
  | 'linkedin-outbound-angle'
  | 'campaign-angle-finder'
  | 'outbound-campaign-architect'
  | 'copywriting-vp-sequence'
  | 'copywriting-manager-sequence'
  | 'copywriting-ic-sequence'
  | 'copywriting-first-touch'
  | 'copywriting-follow-up'
  | 'cta-designer'
  | 'copywriting-refiner'
  | 'copywriting-analyzer'
  | 'gtm-action-thinker'

/**
 * Minimal LLM surface. The facade hands the atom name and a structured input
 * object; the implementation builds the prompt from
 * `.claude/skills/lemlist/<atom>/SKILL.md` and returns a JSON string.
 *
 * Each atom has its own JSON contract documented in the calling stage in
 * `campaign-from-icp.ts`. Tests stub `call` with deterministic JSON fixtures.
 */
export interface LlmClient {
  call: (atom: LlmAtomName, input: Record<string, unknown>) => Promise<{ raw: string }>
}
