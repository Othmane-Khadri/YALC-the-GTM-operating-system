import { UnipileClient } from 'unipile-node-sdk'

let client: UnipileClient | null = null

function getClient(): UnipileClient {
  if (!client) {
    const dsn = process.env.UNIPILE_DSN
    const apiKey = process.env.UNIPILE_API_KEY
    if (!dsn || !apiKey) {
      throw new Error('UNIPILE_DSN and UNIPILE_API_KEY must be set')
    }
    client = new UnipileClient(dsn, apiKey)
  }
  return client
}

export class UnipileService {
  isAvailable(): boolean {
    return !!(process.env.UNIPILE_API_KEY && process.env.UNIPILE_DSN)
  }

  async getAccounts() {
    const c = getClient()
    return c.account.getAll()
  }

  async getProfile(accountId: string, identifier: string) {
    const c = getClient()
    return c.users.getProfile({ account_id: accountId, identifier })
  }

  async searchLinkedIn(accountId: string, query: string, limit = 25): Promise<Record<string, unknown>[]> {
    // The SDK doesn't expose a LinkedIn search method — use REST API directly
    const dsn = process.env.UNIPILE_DSN!
    const apiKey = process.env.UNIPILE_API_KEY!
    const url = `${dsn}/api/v1/linkedin/search`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify({
        account_id: accountId,
        api: 'classic',
        category: 'people',
        keyword: query,
        limit,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Unipile LinkedIn search failed (${res.status}): ${text}`)
    }
    const data = await res.json() as { items?: Record<string, unknown>[] }
    return data.items ?? []
  }

  async sendConnection(accountId: string, providerId: string, message?: string) {
    const c = getClient()
    return c.users.sendInvitation({
      account_id: accountId,
      provider_id: providerId,
      message,
    })
  }

  async sendMessage(accountId: string, attendeeId: string, text: string) {
    const c = getClient()
    // Start a new chat with the attendee
    return c.messaging.startNewChat({
      account_id: accountId,
      attendees_ids: [attendeeId],
      text,
    })
  }

  async listRelations(accountId: string, limit = 100) {
    const c = getClient()
    return c.users.getAllRelations({ account_id: accountId, limit })
  }

  async getPost(accountId: string, postId: string) {
    const c = getClient()
    return c.users.getPost({ account_id: accountId, post_id: postId })
  }

  async listPostReactions(accountId: string, postId: string): Promise<Record<string, unknown>[]> {
    // SDK doesn't expose a listPostReactions method — use REST endpoint
    const dsn = process.env.UNIPILE_DSN!
    const apiKey = process.env.UNIPILE_API_KEY!
    const url = `${dsn}/api/v1/posts/${encodeURIComponent(postId)}/reactions?account_id=${encodeURIComponent(accountId)}`
    const res = await fetch(url, {
      headers: { 'X-API-KEY': apiKey },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Unipile listPostReactions failed (${res.status}): ${text}`)
    }
    const data = await res.json() as { items?: Record<string, unknown>[] }
    return data.items ?? []
  }

  async listPostComments(accountId: string, postId: string) {
    const c = getClient()
    return c.users.getAllPostComments({ account_id: accountId, post_id: postId })
  }

  async listChats(accountId: string, limit = 100) {
    const dsn = process.env.UNIPILE_DSN!
    const apiKey = process.env.UNIPILE_API_KEY!
    const url = `${dsn}/api/v1/chats?account_id=${encodeURIComponent(accountId)}&limit=${limit}`
    const res = await fetch(url, {
      headers: { 'X-API-KEY': apiKey },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Unipile listChats failed (${res.status}): ${text}`)
    }
    return res.json()
  }

  async getMessages(chatId: string, limit = 50) {
    const dsn = process.env.UNIPILE_DSN!
    const apiKey = process.env.UNIPILE_API_KEY!
    const url = `${dsn}/api/v1/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`
    const res = await fetch(url, {
      headers: { 'X-API-KEY': apiKey },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Unipile getMessages failed (${res.status}): ${text}`)
    }
    return res.json()
  }
}

export const unipileService = new UnipileService()
