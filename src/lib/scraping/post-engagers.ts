import { writeFileSync } from 'fs'
import { unipileService } from '../services/unipile'
import { runImport } from '../qualification/importers'
import type { GTMOSConfig } from '../config/types'

interface ScrapePostOptions {
  config: GTMOSConfig
  url: string
  type: 'both' | 'reactions' | 'comments'
  maxPages: number
  output?: string
  account?: string
}

interface ScrapePostResult {
  resultSetId: string
  totalEngagers: number
  reactorCount: number
  commenterCount: number
  postTitle: string
  outputPath: string
}

/**
 * Extract activity ID from a LinkedIn post URL.
 * Supports:
 *   - linkedin.com/posts/...-activity-7442131010667892736-...
 *   - linkedin.com/feed/update/urn:li:activity:7442131010667892736
 *   - linkedin.com/feed/update/urn:li:ugcPost:7442131010667892736
 */
function extractActivityId(url: string): string {
  // Pattern 1: /posts/...-activity-{id}-...
  const activityMatch = url.match(/activity[/:-](\d+)/)
  if (activityMatch) return activityMatch[1]

  // Pattern 2: urn:li:ugcPost:{id}
  const ugcMatch = url.match(/urn:li:ugcPost:(\d+)/)
  if (ugcMatch) return `urn:li:ugcPost:${ugcMatch[1]}`

  throw new Error(
    `Cannot extract activity ID from URL: ${url}\n` +
    'Expected format: linkedin.com/posts/...-activity-{id}-... or linkedin.com/feed/update/urn:li:activity:{id}'
  )
}

/**
 * Extract slug from LinkedIn profile URL.
 * URLs may contain a human-readable slug (/in/sean-brereton-953a522)
 * or a provider ID (/in/ACoAADf0MW0B...). Both are valid identifiers.
 */
function extractSlug(profileUrl: string): string {
  return profileUrl.split('/in/')[1]?.replace(/\/$/, '') ?? ''
}

/**
 * Split a full name into first/last.
 */
function splitName(fullName: string): { firstName: string; lastName: string } {
  const cleaned = fullName.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim()
  const parts = cleaned.split(' ').filter(Boolean)
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  }
}

/**
 * Normalize a reactor record into the standard engager shape.
 * API shape: { object, value, post_id, author: { id, name, headline, profile_url, network_distance } }
 */
function normalizeReactor(r: Record<string, unknown>): Record<string, unknown> {
  const author = (r.author ?? {}) as Record<string, unknown>
  const { firstName, lastName } = splitName(String(author.name ?? ''))
  const profileUrl = String(author.profile_url ?? '')
  const slug = extractSlug(profileUrl)

  return {
    first_name: firstName,
    last_name: lastName,
    headline: String(author.headline ?? ''),
    company: '',
    linkedin_url: profileUrl,
    linkedin_slug: slug,
    provider_id: String(author.id ?? ''),
    network_distance: String(author.network_distance ?? ''),
    engagement_type: 'Reacted',
    reaction_type: String(r.value ?? 'LIKE'),
    source: 'content_engager',
  }
}

/**
 * Normalize a commenter record into the standard engager shape.
 * API shape: { id, text, date, author: "Name", author_details: { id, headline, profile_url, network_distance } }
 */
function normalizeCommenter(c: Record<string, unknown>): Record<string, unknown> {
  const details = (c.author_details ?? {}) as Record<string, unknown>
  const fullName = typeof c.author === 'string' ? c.author : String(details.name ?? '')
  const { firstName, lastName } = splitName(fullName)
  const profileUrl = String(details.profile_url ?? '')
  const slug = extractSlug(profileUrl)

  return {
    first_name: firstName,
    last_name: lastName,
    headline: String(details.headline ?? ''),
    company: '',
    linkedin_url: profileUrl,
    linkedin_slug: slug,
    provider_id: String(details.id ?? ''),
    network_distance: String(details.network_distance ?? ''),
    engagement_type: 'Commented',
    comment_text: String(c.text ?? ''),
    source: 'content_engager',
  }
}

/**
 * Deduplicate engagers by provider_id, preferring commenters over reactors.
 */
function deduplicateEngagers(engagers: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Map<string, Record<string, unknown>>()

  for (const e of engagers) {
    const key = String(e.provider_id ?? e.linkedin_slug ?? '')
    if (!key) continue

    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, e)
    } else if (e.engagement_type === 'Commented' && existing.engagement_type !== 'Commented') {
      seen.set(key, { ...e, also_reacted: true })
    } else if (existing.engagement_type === 'Commented' && e.engagement_type !== 'Commented') {
      seen.set(key, { ...existing, also_reacted: true })
    }
  }

  return Array.from(seen.values())
}

export async function scrapePostEngagers(opts: ScrapePostOptions): Promise<ScrapePostResult> {
  const { url, type, maxPages, config } = opts

  // 1. Get LinkedIn account (optionally by name)
  const accounts = await unipileService.getAccounts()
  const accountList = (accounts as { items?: Record<string, unknown>[] }).items ?? []
  const linkedinAccounts = accountList.filter(
    (a: Record<string, unknown>) => String(a.type ?? '').toLowerCase() === 'linkedin'
  )
  if (linkedinAccounts.length === 0) {
    throw new Error('No LinkedIn account connected in Unipile. Run setup first.')
  }

  let linkedinAccount: Record<string, unknown>
  if (opts.account) {
    const match = linkedinAccounts.find(
      (a: Record<string, unknown>) => String(a.name ?? '').toLowerCase().includes(opts.account!.toLowerCase())
        || String(a.id ?? '') === opts.account
    )
    if (!match) {
      const names = linkedinAccounts.map((a: Record<string, unknown>) => `${a.name} (${a.id})`).join(', ')
      throw new Error(`Account "${opts.account}" not found. Available: ${names}`)
    }
    linkedinAccount = match
  } else {
    linkedinAccount = linkedinAccounts[0]
  }
  const accountId = String(linkedinAccount.id)
  console.log(`[scrape-post] Using account: ${linkedinAccount.name} (${accountId})`)

  // 2. Extract activity ID and resolve post
  const activityId = extractActivityId(url)
  console.log(`[scrape-post] Resolving post: activity ID ${activityId}`)

  const post = await unipileService.getPost(accountId, activityId) as Record<string, unknown>
  const socialId = String(post.social_id ?? post.id ?? activityId)
  const postText = String(post.text ?? '').slice(0, 100)
  const reactionCount = Number(post.reaction_counter ?? 0)
  const commentCount = Number(post.comment_counter ?? 0)

  console.log(`[scrape-post] Post resolved: "${postText}..."`)
  console.log(`[scrape-post] Reactions: ${reactionCount}, Comments: ${commentCount}`)

  // 3. Scrape reactions and/or comments
  let reactors: Record<string, unknown>[] = []
  let commenters: Record<string, unknown>[] = []

  if (type === 'reactions' || type === 'both') {
    console.log(`[scrape-post] Scraping reactions (max ${maxPages} pages)...`)
    const rawReactions = await unipileService.listPostReactions(accountId, socialId, maxPages)
    reactors = rawReactions.map(normalizeReactor)
    console.log(`[scrape-post] Got ${reactors.length} reactors`)
  }

  if (type === 'comments' || type === 'both') {
    console.log(`[scrape-post] Scraping comments (max ${maxPages} pages)...`)
    const rawComments = await unipileService.listPostComments(accountId, socialId, maxPages)
    commenters = rawComments.map(normalizeCommenter)
    console.log(`[scrape-post] Got ${commenters.length} commenters`)
  }

  // 4. Merge and deduplicate
  const allEngagers = [...commenters, ...reactors]
  const deduplicated = deduplicateEngagers(allEngagers)
  console.log(`[scrape-post] ${deduplicated.length} unique engagers after dedup`)

  // 5. Save JSON output
  const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '')
  const outputPath = opts.output ?? `/tmp/linkedin_scrape_${type}_${timestamp}.json`
  writeFileSync(outputPath, JSON.stringify(deduplicated, null, 2))
  console.log(`[scrape-post] Saved to ${outputPath}`)

  // 6. Import into SQLite
  const imported = await runImport({
    config,
    source: 'engagers',
    input: outputPath,
  })
  console.log(`[scrape-post] Imported into result set: ${imported.resultSetId}`)

  return {
    resultSetId: imported.resultSetId,
    totalEngagers: deduplicated.length,
    reactorCount: reactors.length,
    commenterCount: commenters.length,
    postTitle: postText,
    outputPath,
  }
}
