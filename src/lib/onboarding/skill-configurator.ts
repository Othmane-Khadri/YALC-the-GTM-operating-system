import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import yaml from 'js-yaml'
import { getAnthropicClient, PLANNER_MODEL } from '../ai/client'
import type { GTMFramework } from '../framework/types'
import type { GTMGoals } from './goal-setter'

const GTM_OS_DIR = join(homedir(), '.gtm-os')

export async function configureSkills(framework: GTMFramework, goals: GTMGoals): Promise<void> {
  console.log('\n[configure] Configuring skills based on goals...')

  if (!existsSync(GTM_OS_DIR)) mkdirSync(GTM_OS_DIR, { recursive: true })

  // 1. Set provider preferences
  const providerPrefs: Record<string, string> = {}
  if (goals.campaignStyle === 'high-touch' || framework.company.stage === 'enterprise') {
    providerPrefs.search = 'crustdata'
    providerPrefs.enrich = 'fullenrich'
  } else {
    providerPrefs.search = 'firecrawl'
    providerPrefs.enrich = 'unipile'
  }

  console.log(`[configure] Provider preferences: search=${providerPrefs.search}, enrich=${providerPrefs.enrich}`)

  // 2. Generate qualification rules
  const anthropic = getAnthropicClient()

  const rulesResponse = await anthropic.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Generate headline qualification rules (one regex pattern per line) for this ICP:

Company: ${framework.company.name} (${framework.company.industry})
Target Roles: ${framework.segments[0]?.targetRoles?.join(', ') ?? 'decision makers'}
Target Industries: ${framework.segments[0]?.targetIndustries?.join(', ') ?? 'technology'}
Disqualifiers: ${framework.segments[0]?.disqualifiers?.join(', ') ?? 'student, intern'}

Output ONLY the regex patterns, one per line. No explanations. Example:
(?i)(cto|ceo|vp|director|head of)
(?i)(engineering|product|growth|marketing)`,
    }],
  })

  const rulesText = rulesResponse.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('')

  writeFileSync(join(GTM_OS_DIR, 'qualification_rules.md'), rulesText)
  console.log('[configure] Generated qualification_rules.md')

  // 3. Generate campaign templates
  const templateResponse = await anthropic.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `Generate LinkedIn outreach templates for this company:

Company: ${framework.company.name}
Value Prop: ${framework.positioning.valueProp}
Target: ${framework.segments[0]?.name ?? 'Decision makers'}
Style: ${goals.campaignStyle}
Voice: ${framework.segments[0]?.voice?.tone ?? 'professional, concise'}

Generate 3 items in YAML format:
- connect_note: (max 300 chars)
- dm1_template: (use {{first_name}} and {{company}} placeholders)
- dm2_template: (follow-up, use {{first_name}} placeholder)

Output ONLY the YAML, no explanations.`,
    }],
  })

  const templateText = templateResponse.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('')

  writeFileSync(join(GTM_OS_DIR, 'campaign_templates.yaml'), templateText)
  console.log('[configure] Generated campaign_templates.yaml')

  // 4. Generate search queries
  const queries = [
    ...framework.signals.monitoringKeywords,
    ...framework.signals.buyingIntentSignals.slice(0, 5),
    ...(framework.segments[0]?.targetIndustries ?? []).slice(0, 3),
  ].filter(Boolean)

  if (queries.length > 0) {
    writeFileSync(join(GTM_OS_DIR, 'search_queries.txt'), queries.join('\n'))
    console.log(`[configure] Generated search_queries.txt with ${queries.length} queries`)
  }

  // 5. Update config
  const configPath = join(GTM_OS_DIR, 'config.yaml')
  let existingConfig: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8')
      existingConfig = (yaml.load(raw) as Record<string, unknown>) ?? {}
    } catch { /* */ }
  }

  const updatedConfig = {
    ...existingConfig,
    provider_preferences: providerPrefs,
    goals: {
      primary: goals.primaryGoal,
      channels: goals.channels,
      target_volume: goals.targetVolume,
      campaign_style: goals.campaignStyle,
    },
  }

  writeFileSync(configPath, yaml.dump(updatedConfig))
  console.log('[configure] Updated config.yaml with goals and preferences')

  console.log('\n── Configuration Complete ──')
  console.log(`Files generated in ${GTM_OS_DIR}:`)
  console.log('  - qualification_rules.md')
  console.log('  - campaign_templates.yaml')
  if (queries.length > 0) console.log('  - search_queries.txt')
  console.log('  - config.yaml (updated)')
}
