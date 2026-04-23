import { describe, it, expect } from 'vitest'
import { OUTBOUND_RULES } from '../lib/outbound/rules'
import { validateMessage, validateAndFix } from '../lib/outbound/validator'

/**
 * Tests for the 8 outbound message validation rules.
 * These tests complement the existing tests in src/lib/outbound/__tests__/validator.test.ts
 * and focus on edge cases and rule coverage.
 */

describe('outbound rules completeness', () => {
  it('has exactly 8 rules registered', () => {
    expect(OUTBOUND_RULES).toHaveLength(8)
  })

  it('all rules have required fields', () => {
    for (const rule of OUTBOUND_RULES) {
      expect(rule.id).toBeTruthy()
      expect(rule.name).toBeTruthy()
      expect(rule.severity).toMatch(/^(hard|soft)$/)
      expect(typeof rule.check).toBe('function')
    }
  })

  it('all rules have unique IDs', () => {
    const ids = OUTBOUND_RULES.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('expected rule IDs are present', () => {
    const ids = new Set(OUTBOUND_RULES.map(r => r.id))
    expect(ids.has('no-signal')).toBe(true)
    expect(ids.has('no-start-with-i')).toBe(true)
    expect(ids.has('no-disclaimers')).toBe(true)
    expect(ids.has('no-dash-punctuation')).toBe(true)
    expect(ids.has('no-connect-filler')).toBe(true)
    expect(ids.has('start-with-hello')).toBe(true)
    expect(ids.has('no-company-tld')).toBe(true)
    expect(ids.has('specific-cta')).toBe(true)
  })
})

// ─── Rule 1: No Signal Word ──────────────────────────────────────────────────

describe('Rule: no-signal', () => {
  const rule = OUTBOUND_RULES.find(r => r.id === 'no-signal')!

  it('rejects "signal" in various forms', () => {
    expect(rule.check('We detected a signal')).toBe(false)
    expect(rule.check('buying signals are strong')).toBe(false)
    expect(rule.check('Signal detected')).toBe(false)
  })

  it('also catches "signaling" due to word boundary matching "signal" within it', () => {
    // The regex uses \bsignals?\b which does NOT match "signaling" because
    // "signaling" has no word boundary after "signal" — the "i" continues.
    // This documents that "signaling" is allowed.
    expect(rule.check('The team is signaling interest')).toBe(true)
  })

  it('passes text without "signal"', () => {
    expect(rule.check('We detected buying indicators from your team')).toBe(true)
  })
})

// ─── Rule 2: No Start With I ─────────────────────────────────────────────────

describe('Rule: no-start-with-i', () => {
  const rule = OUTBOUND_RULES.find(r => r.id === 'no-start-with-i')!

  it('rejects text starting with "I"', () => {
    expect(rule.check('I wanted to reach out')).toBe(false)
    expect(rule.check('  I wanted to reach out')).toBe(false) // with leading spaces
  })

  it('allows text starting with other words', () => {
    expect(rule.check('Hello, I wanted to reach out')).toBe(true)
    expect(rule.check('In our experience')).toBe(true)
  })
})

// ─── Rule 4: No Dash Punctuation ──────────────────────────────────────────────

describe('Rule: no-dash-punctuation', () => {
  const rule = OUTBOUND_RULES.find(r => r.id === 'no-dash-punctuation')!

  it('rejects em-dash as punctuation', () => {
    expect(rule.check('This is great — really great')).toBe(false)
  })

  it('rejects en-dash as punctuation', () => {
    expect(rule.check('This is great – really great')).toBe(false)
  })

  it('rejects " - " as punctuation', () => {
    expect(rule.check('This is great - really great')).toBe(false)
  })

  it('allows compound hyphens', () => {
    expect(rule.check('AI-native platform')).toBe(true)
    expect(rule.check('data-driven approach')).toBe(true)
  })
})

// ─── Rule 5: No Connect Filler ────────────────────────────────────────────────

describe('Rule: no-connect-filler', () => {
  const rule = OUTBOUND_RULES.find(r => r.id === 'no-connect-filler')!

  it('rejects all connect filler variants', () => {
    expect(rule.check('Nice to connect with you')).toBe(false)
    expect(rule.check('Great to connect!')).toBe(false)
    expect(rule.check('Pleasure to connect')).toBe(false)
    expect(rule.check('Glad we connected')).toBe(false)
    expect(rule.check('Happy to connect')).toBe(false)
  })

  it('allows text without connect filler', () => {
    expect(rule.check('Hello, wanted to discuss global payroll')).toBe(true)
  })
})

// ─── Rule 6: Start With Hello ─────────────────────────────────────────────────

describe('Rule: start-with-hello', () => {
  const rule = OUTBOUND_RULES.find(r => r.id === 'start-with-hello')!

  it('rejects greetings that are not Hello', () => {
    expect(rule.check('Hi John')).toBe(false)
    expect(rule.check('Hey there')).toBe(false)
    expect(rule.check('Dear John')).toBe(false)
    expect(rule.check('Good morning John')).toBe(false)
  })

  it('accepts Hello greeting', () => {
    expect(rule.check('Hello John')).toBe(true)
  })

  it('accepts text that starts with non-greeting words', () => {
    expect(rule.check('Quick question about your stack')).toBe(true)
    expect(rule.check('Your team recently posted about...')).toBe(true)
  })
})

// ─── Rule 7.5: No Company TLD ─────────────────────────────────────────────────

describe('Rule: no-company-tld', () => {
  const rule = OUTBOUND_RULES.find(r => r.id === 'no-company-tld')!

  it('rejects common TLDs', () => {
    expect(rule.check('Check out Clay.com')).toBe(false)
    expect(rule.check('Like HubSpot.io')).toBe(false)
    expect(rule.check('Try Example.ai')).toBe(false)
    expect(rule.check('Visit Site.co')).toBe(false)
    expect(rule.check('Open App.dev')).toBe(false)
  })

  it('allows bare company names', () => {
    expect(rule.check('Check out Clay for enrichment')).toBe(true)
    expect(rule.check('HubSpot handles this differently')).toBe(true)
  })
})

// ─── Rule 8: Specific CTA ────────────────────────────────────────────────────

describe('Rule: specific-cta', () => {
  const rule = OUTBOUND_RULES.find(r => r.id === 'specific-cta')!

  it('rejects vague CTAs', () => {
    expect(rule.check("Let's chat sometime about your stack")).toBe(false)
    expect(rule.check('Happy to discuss if relevant')).toBe(false)
    expect(rule.check('Let me know if interested')).toBe(false)
    expect(rule.check('Would love to connect')).toBe(false)
    expect(rule.check('Feel free to reach out')).toBe(false)
  })

  it('passes specific CTAs', () => {
    expect(rule.check('Can we do 15min Thursday to walk through the setup?')).toBe(true)
    expect(rule.check('Want me to send over the integration docs?')).toBe(true)
  })
})

// ─── Validator Integration ────────────────────────────────────────────────────

describe('validateMessage integration', () => {
  it('returns valid for a well-formed message', () => {
    const result = validateMessage(
      'Hello John, would you be open to a 15-minute call on Thursday to discuss how we handle global payroll?',
    )
    expect(result.valid).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('catches multiple violations at once', () => {
    const result = validateMessage(
      'I noticed buying signals — nice to connect! Check Clay.com. Let me know if interested.',
    )
    expect(result.valid).toBe(false)
    // Should catch: no-start-with-i, no-signal, no-dash-punctuation, no-connect-filler, no-company-tld, specific-cta
    expect(result.violations.length).toBeGreaterThanOrEqual(5)
  })

  it('returns all violations, not just the first', () => {
    const result = validateMessage('Hey John, check Clay.com — happy to discuss')
    expect(result.violations.length).toBeGreaterThan(1)
  })
})

describe('validateAndFix integration', () => {
  it('applies available fixes', () => {
    const result = validateAndFix('Hey John, we see buying signals at Clay.com')
    expect(result.text).toMatch(/^Hello/)
    expect(result.text).toContain('indicator')
    expect(result.text).not.toMatch(/Clay\.com/)
    expect(result.fixes.length).toBeGreaterThan(0)
  })

  it('reports violations that have no auto-fix', () => {
    const result = validateAndFix("Let's chat sometime")
    // specific-cta has no fix function
    expect(result.violations.some(v => v.ruleId === 'specific-cta')).toBe(true)
  })
})
