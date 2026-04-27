import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import yaml from 'js-yaml'
import { getAnthropicClient, PLANNER_MODEL } from '../ai/client'
import type { GTMFramework } from '../framework/types'
import type { GTMGoals } from './goal-setter'
import { ensurePreviewDir, previewPath, type TenantContext } from './preview'

const GTM_OS_DIR = join(homedir(), '.gtm-os')

export async function configureSkills(
  framework: GTMFramework,
  goals: GTMGoals,
  opts: { tenant?: TenantContext } = {},
): Promise<void> {
  console.log('\n[configure] Configuring skills based on goals...')

  if (!existsSync(GTM_OS_DIR)) mkdirSync(GTM_OS_DIR, { recursive: true })

  const tenant = opts.tenant
  // Step 4 writes go through the preview tree so the user sees them under
  // `_preview/` and they only land at live root on `--commit-preview`.
  const writePreview = (canonical: string, body: string): void => {
    ensurePreviewDir(canonical, tenant)
    writeFileSync(previewPath(canonical, tenant), body)
  }

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

  writePreview('qualification_rules.md', rulesText)
  console.log('[configure] Generated qualification_rules.md (preview)')

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

  writePreview('campaign_templates.yaml', templateText)
  console.log('[configure] Generated campaign_templates.yaml (preview)')

  // 4. Generate search queries
  const queries = [
    ...framework.signals.monitoringKeywords,
    ...framework.signals.buyingIntentSignals.slice(0, 5),
    ...(framework.segments[0]?.targetIndustries ?? []).slice(0, 3),
  ].filter(Boolean)

  if (queries.length > 0) {
    writePreview('search_queries.txt', queries.join('\n'))
    console.log(`[configure] Generated search_queries.txt with ${queries.length} queries (preview)`)
  }

  // 5. Update config — read live, write preview. The live config holds
  // everything Step 1 already persisted (provider keys/choices); we layer the
  // synthesis-time goals + provider_preferences on top. Commit moves the
  // preview file over the live one, so no live data is lost.
  const liveConfigPath = join(GTM_OS_DIR, 'config.yaml')
  let existingConfig: Record<string, unknown> = {}
  if (existsSync(liveConfigPath)) {
    try {
      const raw = readFileSync(liveConfigPath, 'utf-8')
      existingConfig = (yaml.load(raw) as Record<string, unknown>) ?? {}
    } catch { /* */ }
  }

  // Build goals YAML with explicit nulls + TODO comments. We never let the
  // LLM-derived `goals` recommendation become a silent default — the user
  // should fill these after seeing real outbound data. Doctor warns until set.
  const goalsBlock: Record<string, unknown> = {
    primary: null,
    channels: null,
    target_volume: null,
    campaign_style: null,
  }

  const updatedConfig = {
    ...existingConfig,
    provider_preferences: providerPrefs,
    goals: goalsBlock,
  }

  // Render config.yaml with TODO comments injected next to each goal field so
  // a casual `cat ~/.gtm-os/config.yaml` makes the unset state obvious.
  const dumped = yaml.dump(updatedConfig)
  const annotated = dumped.replace(/^goals:\n([\s\S]*?)(?=^[a-zA-Z_]|$)/m, (_match, body: string) => {
    const lines = body
      .split('\n')
      .map((line) => {
        const m = line.match(/^(\s+)(primary|channels|target_volume|campaign_style):\s*null\s*$/)
        if (!m) return line
        const key = m[2]
        const hint =
          key === 'primary' ? "e.g. 'Generate 50 qualified leads/month'"
          : key === 'channels' ? "e.g. ['linkedin', 'email']"
          : key === 'target_volume' ? 'monthly lead volume (number)'
          : "'high-touch' | 'volume' | 'test-and-learn'"
        return `${line}  # TODO: ${hint}`
      })
      .join('\n')
    return `goals:\n${lines}`
  })

  // Hint about the recommendation Claude derived, without using it as default.
  const recommendation = [
    '# Recommended (Claude derivation — not auto-applied):',
    `#   primary: ${JSON.stringify(goals.primaryGoal)}`,
    `#   channels: ${JSON.stringify(goals.channels)}`,
    `#   target_volume: ${goals.targetVolume}`,
    `#   campaign_style: ${goals.campaignStyle}`,
    '# Edit `goals:` below with your actuals after running outbound for ~30 days.',
    '',
  ].join('\n')

  writePreview('config.yaml', `${recommendation}${annotated}`)
  console.log('[configure] Updated config.yaml with provider preferences (preview)')
  console.log('[configure] Goals block left as TODO — fill in `~/.gtm-os/config.yaml` after first month of outbound.')

  console.log('\n── Configuration Complete ──')
  console.log('Files staged in preview (commit with `yalc-gtm start --commit-preview`):')
  console.log('  - qualification_rules.md')
  console.log('  - campaign_templates.yaml')
  if (queries.length > 0) console.log('  - search_queries.txt')
  console.log('  - config.yaml (provider_preferences updated, goals: TODO)')
}
