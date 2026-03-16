import { Client } from '@notionhq/client'

let client: Client | null = null

function getClient(): Client {
  if (!client) {
    const auth = process.env.NOTION_API_KEY
    if (!auth) {
      throw new Error('NOTION_API_KEY must be set')
    }
    client = new Client({ auth })
  }
  return client
}

export class NotionService {
  isAvailable(): boolean {
    return !!process.env.NOTION_API_KEY
  }

  async queryDatabase(databaseId: string, filter?: Record<string, unknown>) {
    const c = getClient()
    const allResults: Record<string, unknown>[] = []
    let startCursor: string | undefined

    do {
      const response = await c.databases.query({
        database_id: databaseId,
        filter: filter as Parameters<typeof c.databases.query>[0]['filter'],
        start_cursor: startCursor,
        page_size: 100,
      })
      allResults.push(...(response.results as unknown as Record<string, unknown>[]))
      startCursor = response.has_more && response.next_cursor
        ? response.next_cursor
        : undefined
    } while (startCursor)

    return allResults
  }

  async createPage(databaseId: string, properties: Record<string, unknown>) {
    const c = getClient()
    return c.pages.create({
      parent: { database_id: databaseId },
      properties: properties as Parameters<typeof c.pages.create>[0]['properties'],
    })
  }

  async updatePage(pageId: string, properties: Record<string, unknown>) {
    const c = getClient()
    return c.pages.update({
      page_id: pageId,
      properties: properties as Parameters<typeof c.pages.update>[0]['properties'],
    })
  }

  async search(query: string, filter?: { property: 'object'; value: 'page' | 'database' }) {
    const c = getClient()
    return c.search({
      query,
      filter,
    })
  }

  async bulkCreateLeads(
    databaseId: string,
    leads: Record<string, unknown>[],
    titleField = 'Name',
  ): Promise<{ created: number; failed: number }> {
    const BATCH_SIZE = 40
    let created = 0
    let failed = 0

    for (let i = 0; i < leads.length; i += BATCH_SIZE) {
      const batch = leads.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(lead => {
          const properties: Record<string, unknown> = {
            [titleField]: {
              title: [{ text: { content: String(lead.company_name ?? lead.name ?? 'Unknown') } }],
            },
          }
          // Map standard fields to Notion properties
          if (lead.website) {
            properties['Website'] = { url: String(lead.website) }
          }
          if (lead.industry) {
            properties['Industry'] = { rich_text: [{ text: { content: String(lead.industry) } }] }
          }
          if (lead.location) {
            properties['Location'] = { rich_text: [{ text: { content: String(lead.location) } }] }
          }
          if (lead.description) {
            properties['Description'] = { rich_text: [{ text: { content: String(lead.description).slice(0, 2000) } }] }
          }
          return this.createPage(databaseId, properties)
        }),
      )
      for (const r of results) {
        if (r.status === 'fulfilled') created++
        else failed++
      }
    }

    return { created, failed }
  }
}

export const notionService = new NotionService()
