export type IdentityCandidateType = 'provider_id' | 'linkedin_url' | 'email' | 'manual_link'
export type IdentityEvidenceType = 'provider_payload' | 'manual_link'

export interface IdentityCandidate {
  type: IdentityCandidateType
  value: string
  evidenceType: IdentityEvidenceType
}

/** Input may include presentation fields, but they are never identity evidence. */
export interface IdentityEvidenceInput {
  externalIdentityId?: string | null
  linkedinUrl?: string | null
  email?: string | null
  manualLink?: string | null
  firstName?: string | null
  company?: string | null
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null
  const normalized = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null
  return normalized
}

/** Normalize only LinkedIn personal-profile URLs; unrelated paths are not evidence. */
export function normalizeLinkedInUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url.trim()) return null
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }

  const hostname = parsed.hostname.toLowerCase()
  if (hostname !== 'linkedin.com' && hostname !== 'www.linkedin.com') return null
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length !== 2 || segments[0].toLowerCase() !== 'in' || !segments[1]) return null

  return `https://www.linkedin.com/in/${segments[1].toLowerCase()}`
}

function nonEmptyTrimmed(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

/**
 * Produces only independently verifiable evidence, in deterministic priority
 * order. Names and companies deliberately never participate in linking.
 */
export function buildIdentityCandidates(input: IdentityEvidenceInput): IdentityCandidate[] {
  const candidates: IdentityCandidate[] = []
  const externalIdentityId = nonEmptyTrimmed(input.externalIdentityId)
  const linkedinUrl = normalizeLinkedInUrl(input.linkedinUrl)
  const email = normalizeEmail(input.email)
  const manualLink = nonEmptyTrimmed(input.manualLink)

  if (externalIdentityId) {
    candidates.push({ type: 'provider_id', value: externalIdentityId, evidenceType: 'provider_payload' })
  }
  if (linkedinUrl) {
    candidates.push({ type: 'linkedin_url', value: linkedinUrl, evidenceType: 'provider_payload' })
  }
  if (email) {
    candidates.push({ type: 'email', value: email, evidenceType: 'provider_payload' })
  }
  if (manualLink) {
    candidates.push({ type: 'manual_link', value: manualLink, evidenceType: 'manual_link' })
  }

  return candidates
}
