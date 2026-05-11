import { readFileSync } from 'fs'
import { unipileService } from '../services/unipile'
import { firecrawlService } from '../services/firecrawl'
import { getAnthropicClient, QUALIFIER_MODEL } from '../ai/client'
import { saveFramework } from '../framework/context'
import type { GTMFramework } from '../framework/types'
import { RICH_PROFILE_TOOL } from './rich-profile.js'

interface OnboardOptions {
  linkedin?: string
  website?: string
  knowledge?: string[]
}

export async function buildProfile(opts: OnboardOptions): Promise<GTMFramework> {
  console.log('[onboard] Building GTM framework profile...')

  const contextParts: string[] = []

  // 1. LinkedIn profile data
  if (opts.linkedin && unipileService.isAvailable()) {
    console.log('[onboard] Fetching LinkedIn profile...')
    try {
      const accounts = await unipileService.getAccounts()
      const items = (accounts as { items?: { id: string }[] })?.items ?? []
      if (items.length > 0) {
        const profile = await unipileService.getProfile(items[0].id, opts.linkedin)
        contextParts.push(`## LinkedIn Profile\n${JSON.stringify(profile, null, 2)}`)
      }
    } catch (err) {
      console.log(`[onboard] LinkedIn fetch skipped: ${err instanceof Error ? err.message : err}`)
    }
  }

  // 2. Website content
  if (opts.website && firecrawlService.isAvailable()) {
    console.log('[onboard] Scraping website...')
    try {
      const markdown = await firecrawlService.scrape(opts.website)
      contextParts.push(`## Website Content\n${markdown.slice(0, 10000)}`)
    } catch (err) {
      console.log(`[onboard] Website scrape skipped: ${err instanceof Error ? err.message : err}`)
    }
  }

  // 3. Knowledge files
  if (opts.knowledge && opts.knowledge.length > 0) {
    console.log(`[onboard] Reading ${opts.knowledge.length} knowledge file(s)...`)
    for (const path of opts.knowledge) {
      try {
        const content = readFileSync(path, 'utf-8')
        contextParts.push(`## Knowledge: ${path}\n${content.slice(0, 5000)}`)
      } catch (err) {
        console.log(`[onboard] Skipped ${path}: ${err instanceof Error ? err.message : err}`)
      }
    }
  }

  if (contextParts.length === 0) {
    throw new Error('No data available. Provide at least --linkedin or --website.')
  }

  // 4. Use Claude to build framework
  console.log('[onboard] Analyzing with Claude...')
  const anthropic = getAnthropicClient()

  const response = await anthropic.messages.create({
    model: QUALIFIER_MODEL,
    max_tokens: 4096,
    tools: [RICH_PROFILE_TOOL],
    tool_choice: { type: 'tool' as const, name: 'build_framework' },
    messages: [{
      role: 'user',
      content: `Based on the following business information, build a complete GTM framework:\n\n${contextParts.join('\n\n')}`,
    }],
  })

  // Extract framework from tool use response
  let frameworkData: Partial<GTMFramework> = {}
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'build_framework') {
      frameworkData = block.input as Partial<GTMFramework>
    }
  }

  // Build complete framework with defaults
  const framework: GTMFramework = {
    company: {
      name: '',
      website: opts.website ?? '',
      linkedinUrl: opts.linkedin ?? '',
      industry: '',
      subIndustry: '',
      stage: 'seed',
      description: '',
      teamSize: '',
      foundedYear: 0,
      headquarters: '',
      ...frameworkData.company,
    },
    positioning: {
      valueProp: '',
      tagline: '',
      category: '',
      differentiators: [],
      proofPoints: [],
      competitors: [],
      ...frameworkData.positioning,
    },
    segments: (frameworkData.segments ?? []).map(s => ({
      id: s.id ?? crypto.randomUUID(),
      name: s.name ?? '',
      description: s.description ?? '',
      priority: s.priority ?? 'secondary',
      targetRoles: s.targetRoles ?? [],
      targetCompanySizes: s.targetCompanySizes ?? [],
      targetIndustries: s.targetIndustries ?? [],
      keyDecisionMakers: s.keyDecisionMakers ?? [],
      painPoints: s.painPoints ?? [],
      buyingTriggers: s.buyingTriggers ?? [],
      disqualifiers: s.disqualifiers ?? [],
      voice: s.voice ?? { tone: '', style: '', keyPhrases: [], avoidPhrases: [], writingRules: [], exampleSentences: [] },
      messaging: s.messaging ?? { framework: '', elevatorPitch: '', keyMessages: [], objectionHandling: [] },
      contentStrategy: s.contentStrategy ?? { linkedinPostTypes: [], emailCadence: '', contentThemes: [], redditSubreddits: [], keyTopics: [] },
    })),
    channels: frameworkData.channels ?? {
      active: ['linkedin'],
      preferences: {},
    },
    signals: {
      buyingIntentSignals: [],
      monitoringKeywords: [],
      triggerEvents: [],
      ...frameworkData.signals,
    },
    objections: frameworkData.objections ?? [],
    learnings: [],
    connectedProviders: [],
    onboardingComplete: true,
    lastUpdated: new Date().toISOString(),
    version: 1,
  }

  // 5. Save framework
  await saveFramework(framework)
  console.log('[onboard] Framework saved to DB and YAML')

  // Print summary
  console.log('\n── Framework Summary ──')
  console.log(`Company: ${framework.company.name}`)
  console.log(`Industry: ${framework.company.industry}`)
  console.log(`Value Prop: ${framework.positioning.valueProp}`)
  console.log(`Segments: ${framework.segments.map(s => `${s.name} (${s.priority})`).join(', ')}`)
  console.log(`Signals: ${framework.signals.buyingIntentSignals.length} intent signals, ${framework.signals.triggerEvents.length} triggers`)

  return framework
}
