// ─── Cold Email Generator from URL ──────────────────────────────────────────
// Scrapes a target website via Firecrawl, researches the company via Claude,
// generates a 3-step cold email sequence using the ColdIQ copywriting framework.
// Output: sequence steps ready for send-email-sequence skill or YAML export.

import { getAnthropicClient, PLANNER_MODEL } from '../ai/client'
import { firecrawlService } from '../services/firecrawl'
import { validateAndFix } from '../outbound/validator'

export interface ColdEmailStep {
  subject?: string
  body: string
  delay_days: number
}

export interface CompanyResearch {
  name: string
  sells: string
  icp: string
  keyProof: string
  differentiator: string
}

export async function researchCompany(url: string): Promise<{ research: CompanyResearch; rawMarkdown: string }> {
  // Scrape the website
  let markdown: string
  try {
    markdown = await firecrawlService.scrape(url)
  } catch (err) {
    throw new Error(`Failed to scrape ${url}: ${err instanceof Error ? err.message : err}`)
  }

  if (!markdown || markdown.length < 50) {
    throw new Error(`Scrape returned insufficient content from ${url}`)
  }

  // Truncate to fit context (keep first ~8K chars)
  const truncated = markdown.slice(0, 8000)

  const anthropic = getAnthropicClient()
  const response = await anthropic.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 512,
    system: `You are a B2B sales researcher. Extract company intelligence from website content. Return ONLY valid JSON, no other text.`,
    messages: [{
      role: 'user',
      content: `Analyze this website content and extract:

${truncated}

Return JSON:
{
  "name": "company name",
  "sells": "what they sell in one line",
  "icp": "who buys from them (industry, titles, company size)",
  "keyProof": "best social proof, case study, or metric",
  "differentiator": "what sets them apart from competitors"
}`,
    }],
  })

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('')

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Failed to parse company research JSON from Claude response')

  let research: CompanyResearch
  try {
    research = JSON.parse(jsonMatch[0]) as CompanyResearch
  } catch (err) {
    throw new Error(`Failed to parse company research JSON: ${err instanceof Error ? err.message : err}`)
  }
  return { research, rawMarkdown: truncated }
}

export async function generateColdSequence(
  research: CompanyResearch,
  rawContext: string,
): Promise<ColdEmailStep[]> {
  const anthropic = getAnthropicClient()

  // ColdIQ copywriting framework injected as system prompt
  const systemPrompt = `You are a cold email copywriter. You write sequences that convert strangers into conversations.

## Company You're Selling TO (the prospect's company characteristics — personalize for them):
Company: ${research.name}
Sells: ${research.sells}
ICP: ${research.icp}
Key Proof: ${research.keyProof}
Differentiator: ${research.differentiator}

## Email Structure (4 parts per email, flow naturally):
1. Personalization (1-2 sentences): Hook attention. Must NOT signal a pitch. Short, casual, specific.
2. Who Am I (1-2 sentences): "I [do thing] for [people like you]." Always "I", never "we". Use specific numbers.
3. Offer (1-3 sentences): Specific and tangible. Frame as giving, not selling. Use "X in Y or Z" formula when possible.
4. CTA (1 sentence): Binary yes/no question. Low friction.

## Sequence Strategy:
- Email 1 (Day 0): Full pitch, strongest offer, best angle
- Follow-up 1 (Day 3): Reply to Email 1 (threaded, no subject). Different value prop, shorter.
- Follow-up 2 (Day 7): NEW thread (new subject line). Completely different angle.

Rotate through: Save time, Save money, Make money.

## Tone Rules:
- Write like a person texting, not a company emailing
- Always "I", never "we"
- No exclamation marks in email 1
- No buzzwords: "synergy", "leverage", "innovative", "cutting-edge", "revolutionize"
- Short sentences. Casual. Slightly imperfect.
- No em dashes

## QA Rules:
- 50-90 words per email
- CTA is low-effort (reply in 5 words or less)
- No banned phrases: "hope this finds you well", "wanted to reach out", "I was impressed by", "we help companies", "our platform enables"
- More about them than about you (2:1 ratio)
- All merge fields use {{first_name}}, {{company}} format

## Output Format:
Return ONLY a JSON array, no other text:
[
  { "subject": "...", "body": "...", "delay_days": 0 },
  { "body": "...", "delay_days": 3 },
  { "subject": "...", "body": "...", "delay_days": 7 }
]

Note: Follow-up 1 has NO subject (it's a threaded reply).`

  const response = await anthropic.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Generate a 3-step cold email sequence targeting prospects who would buy from ${research.name}. Use real details from their website. Make it specific and actionable.`,
    }],
  })

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('')

  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('Failed to parse sequence JSON from Claude response')

  let raw: ColdEmailStep[]
  try {
    raw = JSON.parse(jsonMatch[0]) as ColdEmailStep[]
  } catch (err) {
    throw new Error(`Failed to parse sequence JSON: ${err instanceof Error ? err.message : err}`)
  }

  // Validate and fix each email body
  return raw.map((step, i) => {
    const fixResult = validateAndFix(step.body)
    if (fixResult.fixes.length > 0) {
      console.log(`[cold-email-gen] Step ${i + 1} auto-fixed: ${fixResult.fixes.join(', ')}`)
    }
    return {
      subject: step.subject,
      body: fixResult.text,
      delay_days: step.delay_days ?? (i === 0 ? 0 : i === 1 ? 3 : 7),
    }
  })
}

/**
 * End-to-end: URL → research → sequence steps
 */
export async function generateFromUrl(url: string): Promise<{
  research: CompanyResearch
  steps: ColdEmailStep[]
}> {
  const { research, rawMarkdown } = await researchCompany(url)
  const steps = await generateColdSequence(research, rawMarkdown)
  return { research, steps }
}
