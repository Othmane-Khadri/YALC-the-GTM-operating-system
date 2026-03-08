import { NextRequest } from 'next/server'
import { getAnthropicClient, PLANNER_MODEL } from '@/lib/ai/client'
import { validateUrl, UrlValidationError } from '@/lib/web/url-validator'

export const runtime = 'nodejs'

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 10000)
}

function sseData(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

export async function POST(req: NextRequest) {
  const { websiteUrl, linkedinUrl, documents } = await req.json() as {
    websiteUrl: string
    linkedinUrl?: string
    documents?: Array<{ name: string; content: string }>
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseData(obj)))
      }

      try {
        const contextParts: string[] = []

        // Fetch website
        send({ type: 'status', message: 'Analyzing your website...' })
        if (websiteUrl) {
          try {
            const validatedUrl = await validateUrl(websiteUrl)
            const res = await fetch(validatedUrl.toString(), {
              headers: { 'User-Agent': 'GTM-OS/1.0' },
              signal: AbortSignal.timeout(10000),
            })
            const html = await res.text()
            const text = stripHtml(html)
            if (text) contextParts.push(`## Website Content (${websiteUrl})\n${text}`)
          } catch (err) {
            if (err instanceof UrlValidationError) {
              send({ type: 'error', message: `URL blocked: ${err.message}` })
              controller.close()
              return
            }
            // Network/timeout failure — continue with what we have
          }
        }

        // Fetch LinkedIn
        if (linkedinUrl) {
          send({ type: 'status', message: 'Checking LinkedIn profile...' })
          contextParts.push(`## LinkedIn URL: ${linkedinUrl}`)
        }

        // Documents
        if (documents && documents.length > 0) {
          send({ type: 'status', message: `Processing ${documents.length} uploaded document${documents.length > 1 ? 's' : ''}...` })
          documents.forEach((doc) => {
            contextParts.push(`## Document: ${doc.name}\n${doc.content.slice(0, 5000)}`)
          })
        }

        send({ type: 'status', message: 'Extracting company positioning...' })

        const combinedContext = contextParts.join('\n\n---\n\n')

        // Call Claude to extract structured framework
        send({ type: 'status', message: 'Identifying your ICP segments...' })
        const anthropic = getAnthropicClient()

        const response = await anthropic.messages.create({
          model: PLANNER_MODEL,
          max_tokens: 4096,
          tools: [{
            name: 'extract_framework',
            description: 'Extract a structured GTM framework from company information',
            input_schema: {
              type: 'object' as const,
              properties: {
                company: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    website: { type: 'string' },
                    linkedinUrl: { type: 'string' },
                    industry: { type: 'string' },
                    subIndustry: { type: 'string' },
                    stage: { type: 'string', enum: ['pre-seed', 'seed', 'series-a', 'series-b', 'growth', 'enterprise'] },
                    description: { type: 'string' },
                    teamSize: { type: 'string' },
                    foundedYear: { type: 'number' },
                    headquarters: { type: 'string' },
                  },
                  required: ['name', 'website', 'industry', 'description'],
                },
                positioning: {
                  type: 'object',
                  properties: {
                    valueProp: { type: 'string' },
                    tagline: { type: 'string' },
                    category: { type: 'string' },
                    differentiators: { type: 'array', items: { type: 'string' } },
                    proofPoints: { type: 'array', items: { type: 'string' } },
                    competitors: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          website: { type: 'string' },
                          positioning: { type: 'string' },
                          weaknesses: { type: 'array', items: { type: 'string' } },
                          battlecardNotes: { type: 'string' },
                        },
                        required: ['name'],
                      },
                    },
                  },
                  required: ['valueProp', 'category'],
                },
                segments: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      description: { type: 'string' },
                      priority: { type: 'string', enum: ['primary', 'secondary', 'exploratory'] },
                      targetRoles: { type: 'array', items: { type: 'string' } },
                      targetCompanySizes: { type: 'array', items: { type: 'string' } },
                      targetIndustries: { type: 'array', items: { type: 'string' } },
                      keyDecisionMakers: { type: 'array', items: { type: 'string' } },
                      painPoints: { type: 'array', items: { type: 'string' } },
                      buyingTriggers: { type: 'array', items: { type: 'string' } },
                      disqualifiers: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['id', 'name', 'priority'],
                  },
                },
                signals: {
                  type: 'object',
                  properties: {
                    buyingIntentSignals: { type: 'array', items: { type: 'string' } },
                    monitoringKeywords: { type: 'array', items: { type: 'string' } },
                    triggerEvents: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
              required: ['company', 'positioning'],
            },
          }],
          tool_choice: { type: 'tool' as const, name: 'extract_framework' },
          messages: [{
            role: 'user',
            content: `Given the following company information, extract a structured GTM framework. Fill in everything you can infer. For fields you can't determine, use empty strings or empty arrays. Identify 1-3 ICP segments. Be specific and actionable.\n\n${combinedContext}`,
          }],
        })

        send({ type: 'status', message: 'Building messaging frameworks...' })

        // Extract tool use result
        let extracted: Record<string, unknown> = {}
        for (const block of response.content) {
          if (block.type === 'tool_use' && block.name === 'extract_framework') {
            extracted = block.input as Record<string, unknown>
            break
          }
        }

        send({ type: 'status', message: 'Generating voice guidelines...' })

        // Fill in defaults for missing fields
        const framework = {
          company: {
            name: '',
            website: websiteUrl || '',
            linkedinUrl: linkedinUrl || '',
            industry: '',
            subIndustry: '',
            stage: 'seed',
            description: '',
            teamSize: '',
            foundedYear: 0,
            headquarters: '',
            ...(extracted.company as Record<string, unknown> || {}),
          },
          positioning: {
            valueProp: '',
            tagline: '',
            category: '',
            differentiators: [],
            proofPoints: [],
            competitors: [],
            ...(extracted.positioning as Record<string, unknown> || {}),
          },
          segments: ((extracted.segments as Array<Record<string, unknown>>) || []).map((seg) => ({
            id: (seg.id as string) || crypto.randomUUID(),
            name: (seg.name as string) || '',
            description: (seg.description as string) || '',
            priority: (seg.priority as string) || 'secondary',
            targetRoles: (seg.targetRoles as string[]) || [],
            targetCompanySizes: (seg.targetCompanySizes as string[]) || [],
            targetIndustries: (seg.targetIndustries as string[]) || [],
            keyDecisionMakers: (seg.keyDecisionMakers as string[]) || [],
            painPoints: (seg.painPoints as string[]) || [],
            buyingTriggers: (seg.buyingTriggers as string[]) || [],
            disqualifiers: (seg.disqualifiers as string[]) || [],
            voice: { tone: '', style: '', keyPhrases: [], avoidPhrases: [], writingRules: [], exampleSentences: [] },
            messaging: { framework: '', elevatorPitch: '', keyMessages: [], objectionHandling: [] },
            contentStrategy: { linkedinPostTypes: [], emailCadence: '', contentThemes: [], redditSubreddits: [], keyTopics: [] },
          })),
          channels: { active: [], preferences: {} },
          signals: {
            buyingIntentSignals: [],
            monitoringKeywords: [],
            triggerEvents: [],
            ...((extracted.signals as Record<string, unknown>) || {}),
          },
          objections: [],
          learnings: [],
          connectedProviders: [],
          onboardingComplete: false,
          lastUpdated: new Date().toISOString(),
          version: 1,
        }

        send({ type: 'framework', data: framework })
        send({ type: 'done' })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Extraction failed'
        send({ type: 'error', message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
