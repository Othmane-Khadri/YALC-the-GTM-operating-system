import type { Skill, SkillEvent, SkillContext } from '../types'

export const researchSkill: Skill = {
  id: 'research',
  name: 'AI Research Agent',
  version: '1.0.0',
  description: 'General-purpose AI research agent. Takes a question + target (company/person/topic), browses the web, and returns structured answers with evidence chains and confidence scoring.',
  category: 'research',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The research question to answer' },
      targetType: {
        type: 'string',
        enum: ['company', 'person', 'topic'],
        description: 'Type of research target',
      },
      target: { type: 'string', description: 'Target identifier (domain, name, or topic)' },
      maxSources: {
        type: 'number',
        description: 'Maximum number of sources to scrape (1-10)',
        default: 5,
      },
    },
    required: ['question', 'targetType', 'target'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string' },
      answer: { type: 'string' },
      confidence: { type: 'number' },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            scrapedAt: { type: 'string' },
            extractedText: { type: 'string' },
            relevanceScore: { type: 'number' },
          },
        },
      },
      structuredData: { type: 'object' },
    },
  },
  requiredCapabilities: ['search', 'enrich'],

  async *execute(input: unknown, _context: SkillContext): AsyncIterable<SkillEvent> {
    const { question, targetType, target, maxSources } = input as {
      question: string
      targetType: 'company' | 'person' | 'topic'
      target: string
      maxSources?: number
    }

    if (!question || !targetType || !target) {
      yield { type: 'error', message: 'Missing required fields: question, targetType, target' }
      return
    }

    yield { type: 'progress', message: 'Starting research agent...', percent: 0 }

    const { runResearchAgent } = await import('../../scraping/research-agent')

    try {
      const finding = await runResearchAgent(
        { question, targetType, target, maxSources },
        {
          onProgress: (progress) => {
            // Progress events are emitted inline below via the generator
          },
        },
      )

      yield {
        type: 'progress',
        message: `Research complete. Confidence: ${finding.confidence}%. Evidence from ${finding.evidence.length} sources.`,
        percent: 100,
      }

      yield {
        type: 'result',
        data: finding,
      }

      // Emit as a signal for downstream pipeline consumption
      yield {
        type: 'signal',
        signalType: 'research_finding',
        data: {
          question: finding.question,
          answer: finding.answer,
          confidence: finding.confidence,
          sourceCount: finding.evidence.length,
          structuredData: finding.structuredData,
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message: `Research agent failed: ${message}` }
    }
  },
}
