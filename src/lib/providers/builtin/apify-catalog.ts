import type { ProviderCapability, WorkflowStepInput } from '../types'
import type { ColumnDef } from '@/lib/ai/types'

export interface ApifyActorEntry {
  id: string
  actorId: string
  name: string
  description: string
  capabilities: ProviderCapability[]
  columns: ColumnDef[]
  costPer1k: number // estimated cost per 1000 results in USD
  buildInput(config: Record<string, unknown>, step: WorkflowStepInput): Record<string, unknown>
  /** Flatten nested results (e.g. Google Search organicResults). Defaults to identity. */
  extractRows?(rawItems: Record<string, unknown>[]): Record<string, unknown>[]
  normalizeRow(raw: Record<string, unknown>): Record<string, unknown>
}

export const APIFY_CATALOG: ApifyActorEntry[] = [
  // ── 1. General Lead Finder ──────────────────────────────────────────────────
  {
    id: 'apify-leads',
    actorId: 'code_crafter/leads-finder',
    name: 'Apify Lead Finder',
    description:
      'Search for people/companies by criteria (industry, title, location, company size). Returns emails, LinkedIn URLs, company data. Config keys: query, industry, location, title, companySize. Cost ~$1.50/1K leads.',
    capabilities: ['search'],
    costPer1k: 1.50,
    columns: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'title', label: 'Job Title', type: 'text' },
      { key: 'company', label: 'Company', type: 'text' },
      { key: 'linkedin_url', label: 'LinkedIn', type: 'url' },
      { key: 'industry', label: 'Industry', type: 'badge' },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'company_size', label: 'Company Size', type: 'text' },
    ],
    buildInput(config, step) {
      const input: Record<string, unknown> = {
        query: config.query ?? step.description ?? step.title,
        maxResults: step.estimatedRows ?? 50,
      }
      if (config.industry) input.industry = config.industry
      if (config.location) input.location = config.location
      if (config.title) input.jobTitle = config.title
      if (config.companySize) input.companySize = config.companySize
      return input
    },
    normalizeRow(raw) {
      return {
        name: raw.name ?? raw.fullName ?? raw.full_name ?? '',
        email: raw.email ?? raw.emailAddress ?? '',
        title: raw.title ?? raw.jobTitle ?? raw.job_title ?? '',
        company: raw.company ?? raw.companyName ?? raw.company_name ?? '',
        linkedin_url: raw.linkedin ?? raw.linkedinUrl ?? raw.linkedin_url ?? raw.profileUrl ?? '',
        industry: raw.industry ?? '',
        location: raw.location ?? raw.city ?? '',
        company_size: raw.companySize ?? raw.company_size ?? raw.employees ?? '',
      }
    },
  },

  // ── 2. LinkedIn Profile Scraper ─────────────────────────────────────────────
  {
    id: 'apify-linkedin-profiles',
    actorId: 'dev_fusion/linkedin-profile-scraper',
    name: 'LinkedIn Profile Scraper',
    description:
      'Search LinkedIn for people by name, company, or title. Returns verified emails, work history, education, skills. No cookies needed. Config keys: searchTerms (array of names/titles/companies), urls (array of LinkedIn profile URLs). Cost ~$1.50/1K profiles.',
    capabilities: ['search', 'enrich'],
    costPer1k: 1.50,
    columns: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'headline', label: 'Headline', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'linkedin_url', label: 'LinkedIn', type: 'url' },
      { key: 'company', label: 'Company', type: 'text' },
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'connections', label: 'Connections', type: 'number' },
    ],
    buildInput(config, step) {
      if (config.urls) return { urls: config.urls }
      const terms = config.searchTerms ?? config.query ?? step.description ?? step.title
      return {
        searchTerms: Array.isArray(terms) ? terms : [terms],
        maxResults: step.estimatedRows ?? 50,
      }
    },
    normalizeRow(raw) {
      return {
        name: raw.name ?? raw.fullName ?? raw.firstName ? `${raw.firstName ?? ''} ${raw.lastName ?? ''}`.trim() : '',
        headline: raw.headline ?? raw.tagline ?? '',
        email: raw.email ?? raw.emailAddress ?? '',
        linkedin_url: raw.linkedinUrl ?? raw.profileUrl ?? raw.url ?? '',
        company: raw.company ?? raw.companyName ?? raw.currentCompany ?? '',
        title: raw.title ?? raw.jobTitle ?? raw.currentTitle ?? '',
        location: raw.location ?? raw.city ?? '',
        connections: raw.connections ?? raw.connectionCount ?? '',
      }
    },
  },

  // ── 3. LinkedIn Post Engagement Scraper ─────────────────────────────────────
  {
    id: 'apify-linkedin-engagement',
    actorId: 'scraping_solutions/linkedin-posts-engagers-likers-and-commenters-no-cookies',
    name: 'LinkedIn Post Engagement Scraper',
    description:
      'Scrape people who liked or commented on a LinkedIn post. Returns names, headlines, LinkedIn URLs, reaction types. No cookies needed. Config keys: postUrl (required LinkedIn post URL), type ("all", "likes", "comments"). Cost ~$1.20/1K profiles.',
    capabilities: ['search'],
    costPer1k: 1.20,
    columns: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'headline', label: 'Headline', type: 'text' },
      { key: 'linkedin_url', label: 'LinkedIn', type: 'url' },
      { key: 'reaction_type', label: 'Reaction', type: 'badge' },
      { key: 'comment_text', label: 'Comment', type: 'text' },
      { key: 'company', label: 'Company', type: 'text' },
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'location', label: 'Location', type: 'text' },
    ],
    buildInput(config) {
      const postUrl = (config.postUrl ?? config.url ?? config.linkedinUrl) as string | undefined
      if (!postUrl || !postUrl.includes('linkedin.com')) {
        throw new Error('A valid LinkedIn post URL is required (postUrl in config)')
      }
      return {
        postUrl,
        type: (config.engagementType as string) ?? (config.type as string) ?? 'all',
      }
    },
    normalizeRow(raw) {
      return {
        name: raw.name ?? raw.fullName ?? raw.full_name ?? '',
        headline: raw.headline ?? raw.tagline ?? '',
        linkedin_url: raw.profileUrl ?? raw.linkedin_url ?? raw.linkedinUrl ?? raw.url ?? '',
        reaction_type: raw.reactionType ?? raw.reaction_type ?? raw.type ?? '',
        comment_text: raw.comment ?? raw.commentText ?? raw.comment_text ?? '',
        company: raw.company ?? raw.companyName ?? '',
        title: raw.title ?? raw.jobTitle ?? '',
        location: raw.location ?? '',
      }
    },
  },

  // ── 4. Google Maps Scraper ──────────────────────────────────────────────────
  {
    id: 'apify-google-maps',
    actorId: 'compass/crawler-google-places',
    name: 'Google Maps Business Scraper',
    description:
      'Find businesses on Google Maps by keyword + location. Returns name, address, phone, website, rating, reviews count. Config keys: query (e.g. "restaurants in Paris"), location (optional, e.g. "Paris, France"), maxResults. Cost ~$4/1K results.',
    capabilities: ['search'],
    costPer1k: 4.00,
    columns: [
      { key: 'name', label: 'Business Name', type: 'text' },
      { key: 'address', label: 'Address', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'website', label: 'Website', type: 'url' },
      { key: 'rating', label: 'Rating', type: 'number' },
      { key: 'reviews_count', label: 'Reviews', type: 'number' },
      { key: 'category', label: 'Category', type: 'badge' },
      { key: 'location', label: 'Location', type: 'text' },
    ],
    buildInput(config, step) {
      const query = (config.query ?? step.description ?? step.title) as string
      const input: Record<string, unknown> = {
        searchStringsArray: [query],
        maxCrawledPlacesPerSearch: step.estimatedRows ?? 50,
        language: (config.language as string) ?? 'en',
      }
      if (config.location) input.locationQuery = config.location
      return input
    },
    normalizeRow(raw) {
      return {
        name: raw.title ?? raw.name ?? raw.placeName ?? '',
        address: raw.address ?? raw.street ?? raw.fullAddress ?? '',
        phone: raw.phone ?? raw.phoneNumber ?? raw.telephone ?? '',
        website: raw.website ?? raw.url ?? raw.webUrl ?? '',
        rating: raw.totalScore ?? raw.rating ?? raw.stars ?? '',
        reviews_count: raw.reviewsCount ?? raw.reviews ?? raw.totalReviews ?? '',
        category: raw.categoryName ?? raw.category ?? raw.type ?? '',
        location: raw.city ?? raw.neighborhood ?? raw.location ?? '',
      }
    },
  },

  // ── 5. Contact Info Scraper ─────────────────────────────────────────────────
  {
    id: 'apify-contact-info',
    actorId: 'vdrmota/contact-info-scraper',
    name: 'Website Contact Info Scraper',
    description:
      'Extract emails, phone numbers, and social media links from website URLs. Use this to enrich company records with contact details. Config keys: urls (array of website URLs to scrape). Cost ~$0.50/100 websites.',
    capabilities: ['enrich'],
    costPer1k: 0.50,
    columns: [
      { key: 'url', label: 'Website', type: 'url' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'facebook', label: 'Facebook', type: 'url' },
      { key: 'twitter', label: 'Twitter', type: 'url' },
      { key: 'linkedin', label: 'LinkedIn', type: 'url' },
      { key: 'instagram', label: 'Instagram', type: 'url' },
    ],
    buildInput(config) {
      const urls = config.urls ?? config.startUrls
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        throw new Error('urls array is required in config for contact info scraper')
      }
      return {
        startUrls: (urls as string[]).map((u) => ({ url: u })),
        maxRequestsPerStartUrl: 5,
      }
    },
    normalizeRow(raw) {
      const emails = raw.emails ?? raw.email
      const phones = raw.phones ?? raw.phone ?? raw.phoneNumbers
      return {
        url: raw.url ?? raw.website ?? '',
        email: Array.isArray(emails) ? (emails as string[]).join(', ') : (emails ?? ''),
        phone: Array.isArray(phones) ? (phones as string[]).join(', ') : (phones ?? ''),
        facebook: raw.facebook ?? raw.facebookUrl ?? '',
        twitter: raw.twitter ?? raw.twitterUrl ?? '',
        linkedin: raw.linkedin ?? raw.linkedinUrl ?? '',
        instagram: raw.instagram ?? raw.instagramUrl ?? '',
      }
    },
  },

  // ── 6. Google Search Scraper ────────────────────────────────────────────────
  {
    id: 'apify-google-search',
    actorId: 'apify/google-search-scraper',
    name: 'Google Search Results Scraper',
    description:
      'Scrape Google search results for any query. Returns titles, URLs, snippets, positions. Useful for finding companies, articles, or competitor analysis. Config keys: query (search query string), maxResults. Cost ~$2/1K results.',
    capabilities: ['search'],
    costPer1k: 2.00,
    columns: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'url', label: 'URL', type: 'url' },
      { key: 'snippet', label: 'Snippet', type: 'text' },
      { key: 'position', label: 'Position', type: 'number' },
      { key: 'domain', label: 'Domain', type: 'text' },
    ],
    buildInput(config, step) {
      const query = (config.query ?? step.description ?? step.title) as string
      return {
        queries: query,
        maxPagesPerQuery: Math.ceil((step.estimatedRows ?? 10) / 10),
        resultsPerPage: 10,
        languageCode: (config.language as string) ?? '',
        countryCode: (config.country as string) ?? '',
      }
    },
    extractRows(rawItems) {
      // Google Search returns 1 item per query with nested organicResults
      return rawItems.flatMap(item => {
        const organic = item.organicResults
        if (Array.isArray(organic)) return organic as Record<string, unknown>[]
        return [item]
      })
    },
    normalizeRow(raw) {
      const urlStr = (raw.url ?? raw.link ?? raw.displayedUrl ?? '') as string
      let domain = ''
      try {
        domain = urlStr ? new URL(urlStr).hostname : ''
      } catch {
        // Invalid URL
      }
      return {
        title: raw.title ?? raw.name ?? '',
        url: urlStr,
        snippet: raw.description ?? raw.snippet ?? raw.text ?? '',
        position: raw.position ?? raw.rank ?? raw.order ?? '',
        domain,
      }
    },
  },

  // ── 7. LinkedIn Jobs Scraper ────────────────────────────────────────────────
  {
    id: 'apify-linkedin-jobs',
    actorId: 'bebity/linkedin-jobs-scraper',
    name: 'LinkedIn Jobs Scraper',
    description:
      'Scrape LinkedIn job postings to identify companies that are hiring (buying signal). Returns job title, company, location, posted date. Config keys: query (job title/keyword), location (city/country). Cost ~$1/1K jobs.',
    capabilities: ['search'],
    costPer1k: 1.00,
    columns: [
      { key: 'job_title', label: 'Job Title', type: 'text' },
      { key: 'company', label: 'Company', type: 'text' },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'job_url', label: 'Job URL', type: 'url' },
      { key: 'posted_date', label: 'Posted', type: 'text' },
      { key: 'seniority', label: 'Seniority', type: 'badge' },
      { key: 'employment_type', label: 'Type', type: 'badge' },
    ],
    buildInput(config, step) {
      return {
        searchUrl: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(
          (config.query ?? step.description ?? step.title) as string,
        )}${config.location ? `&location=${encodeURIComponent(config.location as string)}` : ''}`,
        maxResults: step.estimatedRows ?? 50,
      }
    },
    normalizeRow(raw) {
      return {
        job_title: raw.title ?? raw.jobTitle ?? raw.position ?? '',
        company: raw.company ?? raw.companyName ?? raw.organization ?? '',
        location: raw.location ?? raw.place ?? raw.city ?? '',
        job_url: raw.url ?? raw.link ?? raw.jobUrl ?? '',
        posted_date: raw.postedDate ?? raw.publishedAt ?? raw.date ?? '',
        seniority: raw.seniorityLevel ?? raw.seniority ?? raw.experienceLevel ?? '',
        employment_type: raw.employmentType ?? raw.contractType ?? raw.type ?? '',
      }
    },
  },

  // ── 8. Website Content Crawler ──────────────────────────────────────────────
  {
    id: 'apify-website-crawler',
    actorId: 'apify/website-content-crawler',
    name: 'Website Content Crawler',
    description:
      'Crawl websites to extract page content, metadata, and text. Useful for competitive analysis, tech stack detection, or content research. Config keys: urls (array of website URLs), maxPages (max pages to crawl per site). Cost ~$1/1K pages.',
    capabilities: ['enrich'],
    costPer1k: 1.00,
    columns: [
      { key: 'url', label: 'URL', type: 'url' },
      { key: 'title', label: 'Page Title', type: 'text' },
      { key: 'text', label: 'Content', type: 'text' },
      { key: 'meta_description', label: 'Description', type: 'text' },
      { key: 'language', label: 'Language', type: 'badge' },
    ],
    buildInput(config) {
      const urls = config.urls ?? config.startUrls
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        throw new Error('urls array is required in config for website crawler')
      }
      return {
        startUrls: (urls as string[]).map((u) => ({ url: u })),
        maxCrawlPages: (config.maxPages as number) ?? 10,
        crawlerType: 'cheerio',
      }
    },
    normalizeRow(raw) {
      const text = (raw.text ?? raw.content ?? raw.body ?? '') as string
      const meta = (raw.metadata ?? {}) as Record<string, unknown>
      return {
        url: raw.url ?? raw.loadedUrl ?? '',
        title: raw.title ?? meta.title ?? '',
        text: text.slice(0, 500),
        meta_description: meta.description ?? raw.description ?? '',
        language: meta.languageCode ?? raw.language ?? '',
      }
    },
  },
]
