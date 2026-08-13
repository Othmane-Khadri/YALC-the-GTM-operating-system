import { describe, expect, it } from 'vitest'
import {
  buildIdentityCandidates,
  normalizeEmail,
  normalizeLinkedInUrl,
} from '../identity'

describe('outreach identity normalization', () => {
  it('normalizes exact email and LinkedIn profile evidence', () => {
    expect(normalizeEmail(' Diego@Example.COM ')).toBe('diego@example.com')
    expect(normalizeLinkedInUrl('https://www.linkedin.com/in/Diego/?trk=abc'))
      .toBe('https://www.linkedin.com/in/diego')
  })

  it('accepts only canonical LinkedIn /in profile URLs', () => {
    expect(normalizeLinkedInUrl('HTTPS://LINKEDIN.COM/in/Diego///?utm=source'))
      .toBe('https://www.linkedin.com/in/diego')
    expect(normalizeLinkedInUrl('https://www.linkedin.com/company/example')).toBeNull()
    expect(normalizeLinkedInUrl('https://www.linkedin.com/posts/example')).toBeNull()
    expect(normalizeLinkedInUrl('https://www.linkedin.com/feed/')).toBeNull()
    expect(normalizeLinkedInUrl('https://example.com/in/diego')).toBeNull()
  })

  it('preserves ordered exact evidence and rejects name or company matching', () => {
    expect(buildIdentityCandidates({
      externalIdentityId: 'provider-person-42',
      linkedinUrl: 'https://linkedin.com/in/Diego/',
      email: ' Diego@Example.COM ',
      manualLink: 'lead-123',
    })).toEqual([
      { type: 'provider_id', value: 'provider-person-42', evidenceType: 'provider_payload' },
      { type: 'linkedin_url', value: 'https://www.linkedin.com/in/diego', evidenceType: 'provider_payload' },
      { type: 'email', value: 'diego@example.com', evidenceType: 'provider_payload' },
      { type: 'manual_link', value: 'lead-123', evidenceType: 'manual_link' },
    ])
    expect(buildIdentityCandidates({ firstName: 'Ana', company: 'Hotel' })).toEqual([])
  })
})
