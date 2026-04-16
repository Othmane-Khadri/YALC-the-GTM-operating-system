import type { Skill, SkillEvent, SkillContext } from '../types'

export const scrapeLinkedinSkill: Skill = {
  id: 'scrape-linkedin',
  name: 'Scrape LinkedIn Post',
  version: '1.0.0',
  description:
    'Scrape reactions and/or comments from a LinkedIn post URL. Exports to CSV/JSON and optionally chains to lead qualification.',
  category: 'research',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'LinkedIn post URL' },
      type: {
        type: 'string',
        enum: ['both', 'reactions', 'comments'],
        description: 'What to scrape',
        default: 'both',
      },
      maxPages: { type: 'number', description: 'Max pagination pages', default: 10 },
      exportFormat: {
        type: 'string',
        enum: ['json', 'csv', 'both'],
        description: 'Export format',
        default: 'json',
      },
      autoQualify: {
        type: 'boolean',
        description: 'Automatically run qualification after scraping',
        default: false,
      },
      outputDir: { type: 'string', description: 'Output directory', default: '/tmp' },
    },
    required: ['url'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      resultSetId: { type: 'string' },
      totalEngagers: { type: 'number' },
      reactorCount: { type: 'number' },
      commenterCount: { type: 'number' },
      exportPaths: { type: 'array', items: { type: 'string' } },
    },
  },
  requiredCapabilities: ['unipile'],

  async *execute(input: unknown, _context: SkillContext): AsyncIterable<SkillEvent> {
    const {
      url,
      type = 'both',
      maxPages = 10,
      exportFormat = 'json',
      autoQualify = false,
      outputDir = '/tmp',
    } = input as {
      url: string
      type?: 'both' | 'reactions' | 'comments'
      maxPages?: number
      exportFormat?: 'json' | 'csv' | 'both'
      autoQualify?: boolean
      outputDir?: string
    }

    yield { type: 'progress', message: 'Loading configuration...', percent: 5 }

    // Load config for the scraper
    const { loadConfig } = await import('../../config/loader')
    const config = loadConfig(
      (process.env.GTM_OS_CONFIG ?? '~/.gtm-os/config.yaml').replace('~', process.env.HOME!),
    )

    yield { type: 'progress', message: `Scraping LinkedIn post: ${url}`, percent: 10 }

    // Call the existing scraper — it handles all heavy lifting
    const { scrapePostEngagers } = await import('../../scraping/post-engagers')
    const result = await scrapePostEngagers({
      config,
      url,
      type,
      maxPages,
    })

    yield {
      type: 'progress',
      message: `Scraped ${result.totalEngagers} engagers (${result.reactorCount} reactors, ${result.commenterCount} commenters)`,
      percent: 60,
    }

    // Export in requested format
    const exportPaths: string[] = []
    if (exportFormat !== 'json') {
      // JSON is already saved by scrapePostEngagers — add CSV if needed
      const { readFileSync } = await import('fs')
      const data = JSON.parse(readFileSync(result.outputPath, 'utf-8')) as Record<string, unknown>[]

      const { exportData } = await import('../../scraping/exporter')
      const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '')
      const paths = exportData(data, outputDir, `linkedin_scrape_${timestamp}`, exportFormat)
      exportPaths.push(...paths)

      yield { type: 'progress', message: `Exported to: ${paths.join(', ')}`, percent: 75 }
    }
    exportPaths.push(result.outputPath)

    // Optionally chain to qualify-leads
    if (autoQualify) {
      yield { type: 'progress', message: 'Chaining to lead qualification...', percent: 80 }

      try {
        const { getSkillRegistryReady } = await import('../registry')
        const registry = await getSkillRegistryReady()
        const qualifySkill = registry.get('qualify-leads')

        if (qualifySkill) {
          for await (const event of qualifySkill.execute(
            { resultSetId: result.resultSetId },
            _context,
          )) {
            if (event.type === 'progress') {
              yield {
                type: 'progress',
                message: `[qualify] ${event.message}`,
                percent: 80 + (event.percent / 100) * 15,
              }
            } else {
              yield event
            }
          }
        }
      } catch (err) {
        yield {
          type: 'error',
          message: `Qualification failed: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    }

    yield {
      type: 'result',
      data: {
        resultSetId: result.resultSetId,
        totalEngagers: result.totalEngagers,
        reactorCount: result.reactorCount,
        commenterCount: result.commenterCount,
        postTitle: result.postTitle,
        exportPaths,
      },
    }

    yield { type: 'progress', message: 'LinkedIn scrape complete.', percent: 100 }
  },
}
