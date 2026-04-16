import { describe, it, expect } from 'vitest'
import { validateMessage, validateAndFix } from '../validator'

describe('validateMessage', () => {
  it('passes a clean message', () => {
    const result = validateMessage('Hello John, would you be open to a 15-minute call on Thursday to discuss how we handle global payroll?')
    expect(result.valid).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('flags "signal" as a hard violation', () => {
    const result = validateMessage('Hello, we detected buying signals from your team.')
    expect(result.valid).toBe(false)
    expect(result.violations.some(v => v.ruleId === 'no-signal')).toBe(true)
  })

  it('flags message starting with "I"', () => {
    const result = validateMessage('I wanted to reach out about your team.')
    expect(result.valid).toBe(false)
    expect(result.violations.some(v => v.ruleId === 'no-start-with-i')).toBe(true)
  })

  it('flags dash punctuation', () => {
    const result = validateMessage('Hello, this is great — really great.')
    expect(result.valid).toBe(false)
    expect(result.violations.some(v => v.ruleId === 'no-dash-punctuation')).toBe(true)
  })

  it('allows compound hyphens like AI-native', () => {
    const result = validateMessage('Hello, our AI-native platform helps with global payroll. Can we do a 15min call Thursday?')
    expect(result.valid).toBe(true)
  })
})

describe('validateAndFix', () => {
  it('auto-fixes "signal" to "indicator"', () => {
    const result = validateAndFix('Hello, we detected buying signals from your team.')
    expect(result.text).toContain('indicator')
    expect(result.text).not.toMatch(/\bsignals?\b/i)
  })

  it('auto-fixes greeting from "Hey" to "Hello"', () => {
    const result = validateAndFix('Hey John, quick question.')
    expect(result.text).toMatch(/^Hello/)
  })
})

// ─── Outbound validation rules ───
describe('outbound validation rules', () => {
  it('flags "not saying this to flex" as a disclaimer', () => {
    const result = validateMessage(
      'Hello John, not saying this to flex but we cut sends by 60%. Can we do 15min Thursday about reducing your CAC?',
    )
    expect(result.valid).toBe(false)
    expect(result.violations.some((v) => v.ruleId === 'no-disclaimers')).toBe(true)
  })

  it('flags "no pitch" as a disclaimer', () => {
    const result = validateMessage(
      'Hello John, no pitch here just wanted to share how teams handle global payroll. Can we do 15min Thursday?',
    )
    expect(result.valid).toBe(false)
    expect(result.violations.some((v) => v.ruleId === 'no-disclaimers')).toBe(true)
  })

  it('flags "just genuine interest" as a disclaimer', () => {
    const result = validateMessage(
      'Hello John, just genuine interest in how you handle onboarding. Can we do 15min Thursday?',
    )
    expect(result.valid).toBe(false)
    expect(result.violations.some((v) => v.ruleId === 'no-disclaimers')).toBe(true)
  })

  it('flags "Clay.com" as a company TLD (LinkedIn auto-linkify)', () => {
    const result = validateMessage(
      'Hello John, our system does what Clay.com does but for replies. Can we do 15min Thursday to walk through the setup?',
    )
    expect(result.valid).toBe(false)
    expect(result.violations.some((v) => v.ruleId === 'no-company-tld')).toBe(true)
  })

  it('flags "example.com" as a company TLD', () => {
    const result = validateMessage(
      'Hello John, example.com runs reply-triggered nurture loops. Can we do 15min Thursday to walk through the setup?',
    )
    expect(result.valid).toBe(false)
    expect(result.violations.some((v) => v.ruleId === 'no-company-tld')).toBe(true)
  })

  it('auto-fixes "Clay.com" → "Clay"', () => {
    const result = validateAndFix('Hello John, our system beats Clay.com for replies.')
    expect(result.text).toContain('beats Clay ')
    expect(result.text).not.toMatch(/\bClay\.com\b/i)
  })

  it('accepts bare company names without TLD', () => {
    const result = validateMessage(
      'Hello John, the way Clay handles enrichment is expensive. Can we do 15min Thursday to walk through a cheaper pattern?',
    )
    expect(result.valid).toBe(true)
  })

  it('flags a message that forgets to say Hello (restored rule)', () => {
    const result = validateMessage(
      'Hey John, quick question about your payroll stack. Can we do 15min Thursday?',
    )
    expect(result.valid).toBe(false)
    expect(result.violations.some((v) => v.ruleId === 'start-with-hello')).toBe(true)
  })
})
