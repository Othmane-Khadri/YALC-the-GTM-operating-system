// ─── Outbound Messaging Rules ────────────────────────────────────────────────
// 7 hard rules that ALL outgoing messages must pass before sending.

export interface OutboundRule {
  id: string
  name: string
  check: (text: string) => boolean // true = passes
  fix?: (text: string) => string
  severity: 'hard' | 'soft'
}

export interface Violation {
  ruleId: string
  ruleName: string
  severity: 'hard' | 'soft'
  excerpt: string
}

// Rule 1: Never use the word "signal" or "signals"
const noSignalWord: OutboundRule = {
  id: 'no-signal',
  name: 'No "signal" word',
  severity: 'hard',
  check: (text) => !/\bsignals?\b/i.test(text),
  fix: (text) => text.replace(/\bsignals?\b/gi, 'indicator'),
}

// Rule 2: Never start with "I"
const noStartWithI: OutboundRule = {
  id: 'no-start-with-i',
  name: 'Never start with "I"',
  severity: 'hard',
  check: (text) => {
    const firstWord = text.trimStart().split(/\s/)[0]
    return firstWord !== 'I'
  },
  fix: (text) => {
    const trimmed = text.trimStart()
    if (trimmed.startsWith('I ')) {
      return 'Hello, ' + trimmed.charAt(0).toLowerCase() + trimmed.slice(1)
    }
    return text
  },
}

// Rule 3: No disclaimers
const noDisclaimers: OutboundRule = {
  id: 'no-disclaimers',
  name: 'No disclaimers',
  severity: 'hard',
  check: (text) => {
    const patterns = [
      /i'm not affiliated/i,
      /full disclosure/i,
      /disclaimer/i,
      /i should mention/i,
      /in the interest of transparency/i,
      /i have no affiliation/i,
      /not sponsored/i,
      /for transparency/i,
    ]
    return !patterns.some((p) => p.test(text))
  },
}

// Rule 4: No dashes as punctuation (em-dash, en-dash, " - ")
// Compound words like "AI-native" are OK
const noDashPunctuation: OutboundRule = {
  id: 'no-dash-punctuation',
  name: 'No dashes as punctuation',
  severity: 'hard',
  check: (text) => {
    // Match " - ", " -- ", " — " (em-dash), " – " (en-dash)
    // But NOT hyphens inside compound words (no spaces around them)
    return !/\s[-–—]{1,2}\s/.test(text)
  },
  fix: (text) => text.replace(/\s[-–—]{1,2}\s/g, '. '),
}

// Rule 5: No "nice to connect" / "great to connect" filler
const noConnectFiller: OutboundRule = {
  id: 'no-connect-filler',
  name: 'No "nice/great to connect" filler',
  severity: 'hard',
  check: (text) => {
    const patterns = [
      /nice to connect/i,
      /great to connect/i,
      /pleasure to connect/i,
      /glad we connected/i,
      /happy to connect/i,
      /good to connect/i,
      /lovely to connect/i,
    ]
    return !patterns.some((p) => p.test(text))
  },
}

// Rule 6: Always start greeting with "Hello"
const startWithHello: OutboundRule = {
  id: 'start-with-hello',
  name: 'Start greeting with "Hello"',
  severity: 'hard',
  check: (text) => {
    const trimmed = text.trimStart()
    // If starts with a greeting word, it must be "Hello"
    const greetingPattern = /^(hi|hey|dear|good morning|good afternoon|good evening)\b/i
    if (greetingPattern.test(trimmed)) return false
    // Either starts with Hello or doesn't start with a greeting at all (both OK)
    return true
  },
  fix: (text) => {
    const trimmed = text.trimStart()
    return trimmed.replace(
      /^(hi|hey|dear|good morning|good afternoon|good evening)\b/i,
      'Hello',
    )
  },
}

// Rule 7: CTA must be specific/actionable
const specificCTA: OutboundRule = {
  id: 'specific-cta',
  name: 'CTA must be specific/actionable',
  severity: 'hard',
  check: (text) => {
    const vagueEndings = [
      /let's chat sometime/i,
      /happy to discuss/i,
      /let me know if interested/i,
      /would love to connect/i,
      /let me know if you'd like to chat/i,
      /feel free to reach out/i,
      /let's connect sometime/i,
      /happy to help if needed/i,
      /open to a conversation/i,
      /let me know your thoughts/i,
    ]
    return !vagueEndings.some((p) => p.test(text))
  },
}

export const OUTBOUND_RULES: OutboundRule[] = [
  noSignalWord,
  noStartWithI,
  noDisclaimers,
  noDashPunctuation,
  noConnectFiller,
  startWithHello,
  specificCTA,
]
