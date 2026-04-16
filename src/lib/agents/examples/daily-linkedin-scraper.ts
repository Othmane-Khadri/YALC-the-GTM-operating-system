// ─── Daily LinkedIn Scraper Agent ────────────────────────────────────────────
// Example agent: scrape a LinkedIn post daily and export results.

import type { AgentConfig } from '../types'

export function createDailyLinkedinScraperConfig(postUrl: string): AgentConfig {
  return {
    id: 'daily-linkedin-scraper',
    name: 'Daily LinkedIn Post Scraper',
    description: `Scrapes reactions/comments from ${postUrl} daily at 08:00 and exports to CSV.`,
    steps: [
      {
        skillId: 'scrape-linkedin',
        input: {
          url: postUrl,
          type: 'both',
          maxPages: 10,
          exportFormat: 'both',
          autoQualify: false,
        },
      },
      {
        skillId: 'export-data',
        input: {
          format: 'csv',
        },
        continueOnError: true,
      },
    ],
    schedule: {
      type: 'daily',
      hour: 8,
      minute: 0,
    },
    maxRetries: 2,
    timeoutMs: 5 * 60 * 1000, // 5 minutes per step
  }
}
