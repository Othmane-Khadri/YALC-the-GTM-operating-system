import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────

// Mock the db module
vi.mock('@/lib/db', () => {
  const rows: Record<string, unknown>[] = []
  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    },
  }
})

// Mock firecrawl service
vi.mock('@/lib/services/firecrawl', () => ({
  firecrawlService: {
    isAvailable: vi.fn().mockReturnValue(true),
    scrape: vi.fn(),
    search: vi.fn(),
  },
}))

// Mock intelligence store
vi.mock('@/lib/intelligence/store', () => ({
  IntelligenceStore: class MockIntelligenceStore {
    add = vi.fn().mockResolvedValue({ id: 'intel-123' })
  },
}))

// Mock drizzle-orm eq
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ _col, _val })),
}))

// Mock the schema
vi.mock('@/lib/db/schema', () => ({
  webCache: { url: 'url', content: 'content', contentType: 'content_type', id: 'id', fetchedAt: 'fetched_at', expiresAt: 'expires_at', extractedInsights: 'extracted_insights' },
  webResearchTasks: { id: 'id', tenantId: 'tenant_id', targetType: 'target_type', targetIdentifier: 'target_identifier', status: 'status', results: 'results', requestedBy: 'requested_by', createdAt: 'created_at', completedAt: 'completed_at' },
}))

const { firecrawlService } = await import('@/lib/services/firecrawl')
const { db } = await import('@/lib/db')

// ─── Imports (after mocks) ───────────────────────────────────────────────

const {
  generateSearchPlan,
  buildExtractionPrompt,
  parseExtractionResponse,
  runResearchAgent,
} = await import('../research-agent')

// ─── Tests ───────────────────────────────────────────────────────────────

describe('Research Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Search plan generation ──
  describe('generateSearchPlan', () => {
    it('generates company-targeted search queries', () => {
      const plan = generateSearchPlan('What CRM do they use?', 'company', 'acme.com', 5)
      expect(plan.length).toBeGreaterThan(0)
      expect(plan.length).toBeLessThanOrEqual(5)
      expect(plan[0].query).toContain('acme.com')
      expect(plan[0].rationale).toBeTruthy()
    })

    it('generates person-targeted search queries', () => {
      const plan = generateSearchPlan('What is their background?', 'person', 'John Doe', 3)
      expect(plan.length).toBeGreaterThan(0)
      expect(plan.length).toBeLessThanOrEqual(3)
      expect(plan.some((p) => p.query.includes('John Doe'))).toBe(true)
    })

    it('generates topic-targeted search queries', () => {
      const plan = generateSearchPlan('Market size?', 'topic', 'AI sales tools', 3)
      expect(plan.length).toBeGreaterThan(0)
      expect(plan.some((p) => p.query.includes('AI sales tools'))).toBe(true)
    })

    it('respects maxSources limit', () => {
      const plan = generateSearchPlan('test', 'company', 'test.com', 2)
      expect(plan.length).toBeLessThanOrEqual(2)
    })
  })

  // ── Extraction prompt ──
  describe('buildExtractionPrompt', () => {
    it('builds a prompt with sources block', () => {
      const prompt = buildExtractionPrompt(
        'What CRM do they use?',
        'acme.com',
        [{ url: 'https://acme.com', content: 'We use Salesforce for CRM.' }],
      )
      expect(prompt).toContain('What CRM do they use?')
      expect(prompt).toContain('acme.com')
      expect(prompt).toContain('SOURCE 1')
      expect(prompt).toContain('Salesforce')
    })

    it('truncates long content to 3000 chars per source', () => {
      const longContent = 'x'.repeat(5000)
      const prompt = buildExtractionPrompt('q', 'target', [{ url: 'https://test.com', content: longContent }])
      // The source block should be truncated
      const sourceSection = prompt.split('SOURCE 1')[1]
      expect(sourceSection.length).toBeLessThan(5000)
    })
  })

  // ── Extraction response parsing ──
  describe('parseExtractionResponse', () => {
    it('parses valid JSON response', () => {
      const raw = JSON.stringify({
        answer: 'They use Salesforce',
        confidence: 85,
        evidence: [
          { sourceIndex: 1, extractedText: 'We use Salesforce', relevanceScore: 90 },
        ],
        structuredData: { crm: 'Salesforce' },
      })

      const result = parseExtractionResponse(raw)
      expect(result.answer).toBe('They use Salesforce')
      expect(result.confidence).toBe(85)
      expect(result.evidence).toHaveLength(1)
      expect(result.evidence[0].extractedText).toBe('We use Salesforce')
      expect(result.structuredData).toEqual({ crm: 'Salesforce' })
    })

    it('strips markdown code fences', () => {
      const raw = '```json\n{"answer":"test","confidence":50,"evidence":[],"structuredData":{}}\n```'
      const result = parseExtractionResponse(raw)
      expect(result.answer).toBe('test')
      expect(result.confidence).toBe(50)
    })

    it('clamps confidence to 0-100', () => {
      const raw = JSON.stringify({ answer: 'x', confidence: 150, evidence: [], structuredData: {} })
      const result = parseExtractionResponse(raw)
      expect(result.confidence).toBe(100)

      const raw2 = JSON.stringify({ answer: 'x', confidence: -10, evidence: [], structuredData: {} })
      const result2 = parseExtractionResponse(raw2)
      expect(result2.confidence).toBe(0)
    })

    it('returns fallback on invalid JSON', () => {
      const result = parseExtractionResponse('not valid json')
      expect(result.answer).toBe('Failed to parse extraction response')
      expect(result.confidence).toBe(0)
      expect(result.evidence).toEqual([])
    })
  })

  // ── Web cache hit (skip scrape) ──
  describe('cache behavior', () => {
    it('uses cached content when available', async () => {
      // Configure db.select mock to return a cached entry
      const cachedRow = {
        id: 'cache-1',
        url: 'https://acme.com',
        content: 'Cached content about Acme using HubSpot',
        contentType: 'text/markdown',
        fetchedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }

      // Search returns one result
      vi.mocked(firecrawlService.search).mockResolvedValue([
        { url: 'https://acme.com', title: 'Acme', content: 'Acme uses HubSpot' },
      ])

      // Scrape should not be called if cache hits
      vi.mocked(firecrawlService.scrape).mockResolvedValue('Fresh scraped content')

      // Mock the db to return cached content for the URL
      let selectCallCount = 0
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              selectCallCount++
              // First calls check gated domain (return empty)
              // Then cache lookup returns the cached row
              if (selectCallCount <= 1) return Promise.resolve([])
              return Promise.resolve([cachedRow])
            }),
          }),
        }),
      } as any)

      // Also mock the select without limit for gated check
      const originalSelect = db.select
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              selectCallCount++
              if (selectCallCount <= 2) return Promise.resolve([])
              return Promise.resolve([cachedRow])
            }),
            then: vi.fn().mockImplementation((cb) => cb([])),
          }),
        }),
      } as any)

      // The important assertion: if cache is populated, scrape might be skipped
      // This is tested at the unit level through getCachedContent
      const { getCachedContent } = await import('../research-agent')

      // Reset mock for getCachedContent test
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([cachedRow]),
          }),
        }),
      } as any)

      const cached = await getCachedContent('https://acme.com')
      expect(cached).not.toBeNull()
      expect(cached?.content).toBe('Cached content about Acme using HubSpot')
    })

    it('returns null for expired cache (>7 days old)', async () => {
      const expiredRow = {
        id: 'cache-old',
        url: 'https://old.com',
        content: 'Old content',
        contentType: 'text/markdown',
        fetchedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      }

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([expiredRow]),
          }),
        }),
      } as any)

      const { getCachedContent } = await import('../research-agent')
      const result = await getCachedContent('https://old.com')
      expect(result).toBeNull()
    })
  })

  // ── Gated domain handling ──
  describe('gated domain handling', () => {
    it('returns null for gated content type', async () => {
      const gatedRow = {
        id: 'cache-gated',
        url: 'https://gated.com/page',
        content: '',
        contentType: 'gated',
        fetchedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([gatedRow]),
          }),
        }),
      } as any)

      const { getCachedContent } = await import('../research-agent')
      const result = await getCachedContent('https://gated.com/page')
      expect(result).toBeNull()
    })

    it('isDomainGated returns true for gated entries', async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{
              url: 'https://gated.com',
              contentType: 'gated',
            }]),
          }),
        }),
      } as any)

      const { isDomainGated } = await import('../research-agent')
      const gated = await isDomainGated('https://gated.com')
      expect(gated).toBe(true)
    })
  })

  // ── Evidence chain creation ──
  describe('evidence chain creation', () => {
    it('maps extraction evidence to research evidence with URLs', () => {
      const extraction = parseExtractionResponse(JSON.stringify({
        answer: 'They use Salesforce',
        confidence: 80,
        evidence: [
          { sourceIndex: 1, extractedText: 'Salesforce is our CRM', relevanceScore: 95 },
          { sourceIndex: 2, extractedText: 'integrated with Salesforce', relevanceScore: 75 },
        ],
        structuredData: { crm: 'Salesforce' },
      }))

      expect(extraction.evidence).toHaveLength(2)
      expect(extraction.evidence[0].sourceIndex).toBe(1)
      expect(extraction.evidence[0].relevanceScore).toBe(95)
      expect(extraction.evidence[1].sourceIndex).toBe(2)
    })
  })

  // ── Full research agent run ──
  describe('runResearchAgent', () => {
    it('completes a full research cycle with mocked Claude', async () => {
      // Mock search results
      vi.mocked(firecrawlService.search).mockResolvedValue([
        { url: 'https://acme.com/about', title: 'About Acme', content: 'Acme uses HubSpot CRM for sales' },
        { url: 'https://review.com/acme', title: 'Acme Review', content: 'Acme relies on HubSpot' },
      ])

      // Mock scrape (will be called for each URL)
      vi.mocked(firecrawlService.scrape).mockResolvedValue('Acme uses HubSpot CRM. They migrated from Salesforce in 2024.')

      // Mock all DB calls to return empty (no cache, no gated)
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
            then: vi.fn().mockImplementation((cb) => cb([])),
          }),
        }),
      } as any)
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      } as any)
      vi.mocked(db.delete).mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      } as any)
      vi.mocked(db.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      } as any)

      const mockClaudeResponse = JSON.stringify({
        answer: 'Acme uses HubSpot CRM, having migrated from Salesforce in 2024',
        confidence: 85,
        evidence: [
          { sourceIndex: 1, extractedText: 'Acme uses HubSpot CRM', relevanceScore: 95 },
          { sourceIndex: 2, extractedText: 'Acme relies on HubSpot', relevanceScore: 80 },
        ],
        structuredData: { crm: 'HubSpot', previous_crm: 'Salesforce', migration_year: 2024 },
      })

      const progressEvents: string[] = []

      const finding = await runResearchAgent(
        {
          question: 'What CRM does Acme use?',
          targetType: 'company',
          target: 'acme.com',
          maxSources: 5,
          tenantId: 'test-tenant',
        },
        {
          onProgress: (p) => progressEvents.push(`[${p.phase}] ${p.message}`),
          callClaude: async () => mockClaudeResponse,
        },
      )

      expect(finding.question).toBe('What CRM does Acme use?')
      expect(finding.answer).toContain('HubSpot')
      expect(finding.confidence).toBeGreaterThan(0)
      expect(finding.evidence.length).toBeGreaterThan(0)
      expect(finding.structuredData).toHaveProperty('crm', 'HubSpot')

      // Verify progress events were emitted
      expect(progressEvents.some((e) => e.includes('planning'))).toBe(true)
      expect(progressEvents.some((e) => e.includes('scraping'))).toBe(true)
      expect(progressEvents.some((e) => e.includes('extracting'))).toBe(true)
    })

    it('respects max sources limit of 10', () => {
      const plan = generateSearchPlan('test', 'company', 'test.com', 15)
      // generateSearchPlan caps at maxSources
      expect(plan.length).toBeLessThanOrEqual(10)
    })

    it('handles no search results gracefully', async () => {
      vi.mocked(firecrawlService.search).mockResolvedValue([])

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
            then: vi.fn().mockImplementation((cb) => cb([])),
          }),
        }),
      } as any)
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      } as any)
      vi.mocked(db.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      } as any)

      const finding = await runResearchAgent(
        {
          question: 'test',
          targetType: 'company',
          target: 'nonexistent-co.xyz',
          maxSources: 3,
        },
        { callClaude: async () => '{}' },
      )

      expect(finding.confidence).toBe(0)
      expect(finding.answer).toContain('No search results')
    })
  })

  // ── Structured output format ──
  describe('structured output format', () => {
    it('returns all required fields in ResearchFinding', async () => {
      vi.mocked(firecrawlService.search).mockResolvedValue([
        { url: 'https://test.com', title: 'Test', content: 'Test content' },
      ])
      vi.mocked(firecrawlService.scrape).mockResolvedValue('Test page content')

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
            then: vi.fn().mockImplementation((cb) => cb([])),
          }),
        }),
      } as any)
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      } as any)
      vi.mocked(db.delete).mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      } as any)
      vi.mocked(db.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      } as any)

      const finding = await runResearchAgent(
        {
          question: 'What is their revenue?',
          targetType: 'company',
          target: 'test.com',
          maxSources: 2,
        },
        {
          callClaude: async () => JSON.stringify({
            answer: '$10M ARR',
            confidence: 60,
            evidence: [{ sourceIndex: 1, extractedText: 'revenue of $10M', relevanceScore: 70 }],
            structuredData: { revenue: '$10M', type: 'ARR' },
          }),
        },
      )

      // Verify all ResearchFinding fields exist
      expect(finding).toHaveProperty('question')
      expect(finding).toHaveProperty('answer')
      expect(finding).toHaveProperty('confidence')
      expect(finding).toHaveProperty('evidence')
      expect(finding).toHaveProperty('structuredData')
      expect(typeof finding.question).toBe('string')
      expect(typeof finding.answer).toBe('string')
      expect(typeof finding.confidence).toBe('number')
      expect(Array.isArray(finding.evidence)).toBe(true)
      expect(typeof finding.structuredData).toBe('object')

      // Verify evidence chain format
      if (finding.evidence.length > 0) {
        const ev = finding.evidence[0]
        expect(ev).toHaveProperty('url')
        expect(ev).toHaveProperty('scrapedAt')
        expect(ev).toHaveProperty('extractedText')
        expect(ev).toHaveProperty('relevanceScore')
      }
    })
  })
})
