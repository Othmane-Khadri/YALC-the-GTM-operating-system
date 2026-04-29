import { describe, it, expect } from 'vitest'
import {
  normalizeListResponse,
  buildNotionSummary,
  parseSignalTypes,
} from '../lib/services/predictleads-enrichment'

describe('predictleads enrichment helpers', () => {
  describe('normalizeListResponse', () => {
    it('handles empty data array', () => {
      expect(normalizeListResponse({ data: [] })).toEqual([])
    })

    it('handles missing data property', () => {
      expect(normalizeListResponse({})).toEqual([])
      expect(normalizeListResponse(null)).toEqual([])
    })

    it('extracts id, attributes, and event date from list item', () => {
      const out = normalizeListResponse({
        data: [
          {
            id: 'job-1',
            type: 'job_opening',
            attributes: { title: 'Senior SE', first_seen_at: '2026-04-15T00:00:00Z' },
          },
        ],
      })
      expect(out.length).toBe(1)
      expect(out[0].signalId).toBe('job-1')
      expect(out[0].eventDate).toBe('2026-04-15T00:00:00Z')
      expect((out[0].payload as Record<string, unknown>).title).toBe('Senior SE')
    })

    it('falls back through event date keys until one is found', () => {
      const out = normalizeListResponse({
        data: [{ id: 'n-1', attributes: { headline: 'X', published_at: '2026-04-10' } }],
      })
      expect(out[0].eventDate).toBe('2026-04-10')
    })

    it('handles single-resource responses (data is object, not array)', () => {
      const out = normalizeListResponse({ data: { id: 'c-1', attributes: { name: 'HubSpot' } } })
      expect(out.length).toBe(1)
      expect(out[0].signalId).toBe('c-1')
    })

    it('returns null eventDate when no recognized date attribute present', () => {
      const out = normalizeListResponse({ data: [{ id: 't-1', attributes: { title: 'Salesforce' } }] })
      expect(out[0].eventDate).toBeNull()
    })
  })

  describe('parseSignalTypes', () => {
    it('returns the four event types when input is undefined (excludes similar_company)', () => {
      const out = parseSignalTypes(undefined)
      expect(out).toEqual(['job_opening', 'financing', 'technology', 'news'])
    })

    it('expands aliases: jobs/funding/tech/news', () => {
      expect(parseSignalTypes('jobs,funding,tech,news')).toEqual([
        'job_opening',
        'financing',
        'technology',
        'news',
      ])
    })

    it('drops unknown tokens silently', () => {
      expect(parseSignalTypes('jobs,bogus,funding')).toEqual(['job_opening', 'financing'])
    })

    it('is case-insensitive and tolerates whitespace', () => {
      expect(parseSignalTypes(' Jobs , FUNDING ')).toEqual(['job_opening', 'financing'])
    })
  })

  describe('buildNotionSummary', () => {
    it('formats funding events with round, amount, date', () => {
      const out = buildNotionSummary([
        {
          signalType: 'financing',
          payload: { round: 'Series B', amount: '$30M' },
          eventDate: '2026-04-12T00:00:00Z',
        },
      ])
      expect(out).toBe('Series B $30M (2026-04-12)')
    })

    it('formats job openings as "Hiring: <title>"', () => {
      const out = buildNotionSummary([
        { signalType: 'job_opening', payload: { title: 'Senior SE' }, eventDate: null },
      ])
      expect(out).toBe('Hiring: Senior SE')
    })

    it('joins multiple signals with " · " separator', () => {
      const out = buildNotionSummary([
        { signalType: 'financing', payload: { round: 'Seed' }, eventDate: '2026-01-01' },
        { signalType: 'job_opening', payload: { title: 'AE' }, eventDate: null },
        { signalType: 'technology', payload: { title: 'Salesforce' }, eventDate: null },
      ])
      expect(out).toBe('Seed (2026-01-01) · Hiring: AE · Uses: Salesforce')
    })

    it('caps to maxItems', () => {
      const out = buildNotionSummary(
        [
          { signalType: 'job_opening', payload: { title: 'A' }, eventDate: null },
          { signalType: 'job_opening', payload: { title: 'B' }, eventDate: null },
          { signalType: 'job_opening', payload: { title: 'C' }, eventDate: null },
          { signalType: 'job_opening', payload: { title: 'D' }, eventDate: null },
        ],
        2,
      )
      expect(out).toBe('Hiring: A · Hiring: B')
    })

    it('truncates long news headlines', () => {
      const long = 'a'.repeat(80)
      const out = buildNotionSummary([
        { signalType: 'news', payload: { title: long }, eventDate: null },
      ])
      expect(out.length).toBeLessThanOrEqual(60)
      expect(out.endsWith('...')).toBe(true)
    })
  })
})
