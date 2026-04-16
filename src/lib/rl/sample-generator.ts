// ─── RL Sample Generator ─────────────────────────────────────────────────────
// Generates varied samples with controlled dimension variation using
// Latin Hypercube Sampling for coverage.

import { getAnthropicClient, PLANNER_MODEL } from '../ai/client'

export type OutputType = 'prose' | 'config' | 'strategy' | 'visual'

interface DimensionTaxonomy {
  [dimension: string]: string[]
}

const PROSE_DIMENSIONS: DimensionTaxonomy = {
  tone: ['formal', 'casual', 'authoritative', 'conversational', 'provocative'],
  length: ['short', 'medium', 'long'],
  structure: ['narrative', 'listicle', 'qa', 'how-to', 'comparison'],
  hook: ['question', 'statistic', 'story', 'bold-claim', 'analogy'],
}

const CONFIG_DIMENSIONS: DimensionTaxonomy = {
  verbosity: ['minimal', 'standard', 'verbose'],
  format: ['yaml', 'json', 'toml'],
  organization: ['flat', 'nested', 'grouped-by-feature'],
}

const STRATEGY_DIMENSIONS: DimensionTaxonomy = {
  depth: ['surface', 'detailed', 'exhaustive'],
  style: ['analytical', 'actionable', 'narrative'],
  timeframe: ['immediate', 'quarterly', 'annual'],
}

const DIMENSION_MAP: Record<OutputType, DimensionTaxonomy> = {
  prose: PROSE_DIMENSIONS,
  config: CONFIG_DIMENSIONS,
  strategy: STRATEGY_DIMENSIONS,
  visual: PROSE_DIMENSIONS, // fallback
}

/**
 * Latin Hypercube Sampling — ensure each dimension value appears roughly equally.
 */
function latinHypercubeSample(
  dimensions: DimensionTaxonomy,
  n: number,
): Array<Record<string, string>> {
  const dimNames = Object.keys(dimensions)
  const samples: Array<Record<string, string>> = []

  for (let i = 0; i < n; i++) {
    const sample: Record<string, string> = {}
    for (const dim of dimNames) {
      const values = dimensions[dim]
      sample[dim] = values[i % values.length]
    }
    samples.push(sample)
  }

  // Shuffle each dimension independently for better coverage
  for (const dim of dimNames) {
    const values = samples.map((s) => s[dim])
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[values[i], values[j]] = [values[j], values[i]]
    }
    samples.forEach((s, i) => (s[dim] = values[i]))
  }

  return samples
}

export interface GeneratedSample {
  id: number
  content: string
  dimensions: Record<string, string>
}

/**
 * Generate N varied samples using Claude with controlled dimension variation.
 */
export async function generateSamples(
  basePrompt: string,
  outputType: OutputType,
  count: number,
): Promise<GeneratedSample[]> {
  const dimensions = DIMENSION_MAP[outputType] ?? PROSE_DIMENSIONS
  const dimensionCombos = latinHypercubeSample(dimensions, count)

  const anthropic = getAnthropicClient()
  const samples: GeneratedSample[] = []

  for (let i = 0; i < count; i++) {
    const dims = dimensionCombos[i]
    const dimInstructions = Object.entries(dims)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')

    const response = await anthropic.messages.create({
      model: PLANNER_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${basePrompt}\n\nStyle constraints for this variation: ${dimInstructions}\n\nGenerate the content now. Output ONLY the content, no meta-commentary.`,
        },
      ],
    })

    const content = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')

    samples.push({ id: i + 1, content, dimensions: dims })
  }

  return samples
}
