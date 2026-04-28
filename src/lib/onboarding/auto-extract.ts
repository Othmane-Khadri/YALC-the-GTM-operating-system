/**
 * Lightweight non-LLM extractor for the no-LLM-needed fields of
 * `company_context.yaml`. Runs over scraped website markdown / HTML before
 * synthesis kicks off so the company name, description and source-tracking
 * fields are never `<UNKNOWN>` when the model has actual content to work
 * from.
 *
 * The extractor is intentionally conservative: it never invents data. If a
 * meta tag or heading isn't present we leave the field empty — the user
 * reviews + corrects in the preview tree.
 */

export interface ExtractedCompanyMeta {
  name?: string
  description?: string
  /**
   * True when at least one of `name` / `description` was sourced from a
   * structured signal (og:site_name, <title>, <meta name="description">,
   * og:description). Hostname-derived fallbacks and free-text first-paragraph
   * extracts do NOT count — those are too noisy to anchor confidence on.
   *
   * Used by 0.8.F preview confidence scoring.
   */
  hasMetadataAnchors?: boolean
}

export interface ExtractInput {
  /** Raw scraped content. Either HTML or already-converted markdown. */
  content: string
  /** Original URL — used to derive a fallback company name. */
  url?: string
}

/**
 * Title-case a slug-ish identifier. Keeps multi-word brands legible
 * ("yalc-gtm" → "Yalc Gtm"). We don't try to be clever about acronyms.
 */
function titleCase(s: string): string {
  return s
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Best-effort company name derived from the URL hostname. Strips `www.`,
 * tlds, and known platform paths. `bitwip.ai` → `Bitwip`,
 * `acme-corp.example.com` → `Acme Corp`.
 */
export function deriveNameFromUrl(url: string): string | undefined {
  if (!url) return undefined
  let host: string
  try {
    const u = new URL(url)
    host = u.hostname
  } catch {
    return undefined
  }
  host = host.replace(/^www\./i, '')
  // Drop TLD chunks: "acme.example.com" -> "acme.example", then "acme".
  // We keep the first label which is the brand name in the vast majority
  // of cases. For multi-label hostnames where the brand is in the middle
  // (e.g. "company.notion.site") this falls back to the first label which
  // is wrong but cosmetic — user fixes it in preview.
  const firstLabel = host.split('.')[0]
  if (!firstLabel) return undefined
  return titleCase(firstLabel)
}

/** Extract a company name from `<title>`, `<h1>`, or `og:site_name`. */
export function extractCompanyName(content: string): string | undefined {
  if (!content) return undefined

  // og:site_name takes priority — it's the most explicit signal.
  const ogSite = content.match(
    /<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i,
  )
  if (ogSite?.[1]) return ogSite[1].trim()

  const ogSiteAlt = content.match(
    /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i,
  )
  if (ogSiteAlt?.[1]) return ogSiteAlt[1].trim()

  const titleTag = content.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (titleTag?.[1]) {
    // Titles often look like "Brand — Tagline" or "Brand: Tagline" or
    // "Brand | Tagline". Prefer the first segment because that's almost
    // always the brand. We accept the separator with or without a leading
    // space (e.g. `Foo: bar` and `Foo : bar` both split). Falls back to
    // the full title if there's no obvious separator.
    const raw = titleTag[1].trim()
    const segs = raw.split(/\s*[—–|·]\s+|\s*:\s+|\s-\s/)
    if (segs.length > 1 && segs[0].trim()) return segs[0].trim()
    return raw
  }

  // First H1 — works for markdown-converted pages too.
  const h1Md = content.match(/^#\s+(.+)$/m)
  if (h1Md?.[1]) return h1Md[1].trim()

  const h1Html = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1Html?.[1]) {
    const stripped = h1Html[1].replace(/<[^>]+>/g, '').trim()
    if (stripped) return stripped
  }

  return undefined
}

/**
 * Extract a short company description. Priority order:
 *   1. `<meta name="description">`
 *   2. `<meta property="og:description">`
 *   3. First paragraph of the body text (after stripping HTML/markdown
 *      heading markers).
 *
 * Truncated to 600 chars so it slots into the YAML without bloating.
 */
export function extractCompanyDescription(content: string): string | undefined {
  if (!content) return undefined

  const metaDesc = content.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i,
  )
  if (metaDesc?.[1]) return clamp(metaDesc[1].trim(), 600)

  const metaDescAlt = content.match(
    /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i,
  )
  if (metaDescAlt?.[1]) return clamp(metaDescAlt[1].trim(), 600)

  const ogDesc = content.match(
    /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i,
  )
  if (ogDesc?.[1]) return clamp(ogDesc[1].trim(), 600)

  const ogDescAlt = content.match(
    /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i,
  )
  if (ogDescAlt?.[1]) return clamp(ogDescAlt[1].trim(), 600)

  // Fall back to the first 1-2 paragraphs of cleaned text. We collapse
  // whitespace, drop heading markers, and pick the first run that's at
  // least 80 chars (filters out nav strings).
  const cleaned = content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/^[#>\-*\s]+/gm, '')
    .replace(/[\t ]+/g, ' ')

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= 80)

  if (paragraphs.length === 0) return undefined
  const joined = paragraphs.slice(0, 2).join(' ')
  return clamp(joined, 600)
}

function clamp(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n).trim() + '…'
}

/**
 * True when the scraped content carries at least one rich metadata anchor —
 * og:site_name, <title>, <meta name="description"> or og:description. Used
 * by 0.8.F confidence scoring; deliberately stricter than `extractCompanyMeta`
 * (which falls back to hostname / first paragraph).
 */
export function hasMetadataAnchors(content: string): boolean {
  if (!content) return false
  const patterns = [
    /<meta[^>]*property=["']og:site_name["'][^>]*content=["'][^"']+["']/i,
    /<meta[^>]*content=["'][^"']+["'][^>]*property=["']og:site_name["']/i,
    /<meta[^>]*property=["']og:description["'][^>]*content=["'][^"']+["']/i,
    /<meta[^>]*content=["'][^"']+["'][^>]*property=["']og:description["']/i,
    /<meta[^>]*name=["']description["'][^>]*content=["'][^"']+["']/i,
    /<meta[^>]*content=["'][^"']+["'][^>]*name=["']description["']/i,
    /<title[^>]*>[^<]+<\/title>/i,
  ]
  return patterns.some((re) => re.test(content))
}

/**
 * Run all extractors over scraped content. Returns whatever fields could
 * be derived; missing fields stay undefined. The caller decides how to
 * merge into the captured `CompanyContext`.
 */
export function extractCompanyMeta(input: ExtractInput): ExtractedCompanyMeta {
  const name =
    extractCompanyName(input.content) ??
    (input.url ? deriveNameFromUrl(input.url) : undefined)
  const description = extractCompanyDescription(input.content)
  const anchored = hasMetadataAnchors(input.content)
  return { name, description, hasMetadataAnchors: anchored }
}
