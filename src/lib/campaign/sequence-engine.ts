// ─── Multi-Channel Sequence Engine ──────────────────────────────────────────
// Evaluates conditions, determines next step, dispatches actions across channels.

import { readFileSync } from 'fs'
import yaml from 'js-yaml'
import type {
  SequenceDefinition,
  SequenceStep,
  LeadSequenceState,
  ChannelStates,
} from './sequence'

// ─── Condition Parser ──────────────────────────────────────────────────────
// Supports: replied_email, replied_linkedin, replied_any, connected_linkedin,
//           opened_email, bounced_email, sent_email, dm_sent_linkedin, connect_sent_linkedin
// Operators: ! (NOT), AND, OR
// Precedence: NOT > AND > OR

type ConditionToken =
  | { type: 'var'; name: string }
  | { type: 'not' }
  | { type: 'and' }
  | { type: 'or' }
  | { type: 'lparen' }
  | { type: 'rparen' }

function tokenize(expr: string): ConditionToken[] {
  const tokens: ConditionToken[] = []
  const words = expr.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').split(/\s+/).filter(Boolean)

  for (const word of words) {
    if (word === 'AND') tokens.push({ type: 'and' })
    else if (word === 'OR') tokens.push({ type: 'or' })
    else if (word === '(') tokens.push({ type: 'lparen' })
    else if (word === ')') tokens.push({ type: 'rparen' })
    else if (word.startsWith('!')) {
      tokens.push({ type: 'not' })
      if (word.length > 1) tokens.push({ type: 'var', name: word.slice(1) })
    } else {
      tokens.push({ type: 'var', name: word })
    }
  }

  return tokens
}

function resolveVar(name: string, states: ChannelStates): boolean {
  switch (name) {
    case 'replied_email': return states.email.replied
    case 'replied_linkedin': return states.linkedin.replied
    case 'replied_any': return states.email.replied || states.linkedin.replied || states.twitter.replied
    case 'connected_linkedin': return states.linkedin.connected
    case 'connect_sent_linkedin': return states.linkedin.connectSent
    case 'opened_email': return states.email.opened
    case 'bounced_email': return states.email.bounced
    case 'sent_email': return states.email.sent
    case 'dm_sent_linkedin': return states.linkedin.dmSent
    case 'profile_viewed_linkedin': return states.linkedin.profileViewed
    case 'followed_twitter': return states.twitter.followed
    case 'liked_twitter': return states.twitter.liked
    case 'called_phone': return states.phone.called
    default: return false
  }
}

// Simple recursive descent parser: OR → AND → NOT → atom
function parseOr(tokens: ConditionToken[], pos: { i: number }, states: ChannelStates): boolean {
  let left = parseAnd(tokens, pos, states)
  while (pos.i < tokens.length && tokens[pos.i].type === 'or') {
    pos.i++ // consume OR
    const right = parseAnd(tokens, pos, states)
    left = left || right
  }
  return left
}

function parseAnd(tokens: ConditionToken[], pos: { i: number }, states: ChannelStates): boolean {
  let left = parseNot(tokens, pos, states)
  while (pos.i < tokens.length && tokens[pos.i].type === 'and') {
    pos.i++ // consume AND
    const right = parseNot(tokens, pos, states)
    left = left && right
  }
  return left
}

function parseNot(tokens: ConditionToken[], pos: { i: number }, states: ChannelStates): boolean {
  if (pos.i < tokens.length && tokens[pos.i].type === 'not') {
    pos.i++ // consume NOT
    return !parseAtom(tokens, pos, states)
  }
  return parseAtom(tokens, pos, states)
}

function parseAtom(tokens: ConditionToken[], pos: { i: number }, states: ChannelStates): boolean {
  if (pos.i >= tokens.length) return false

  const token = tokens[pos.i]
  if (token.type === 'lparen') {
    pos.i++ // consume (
    const result = parseOr(tokens, pos, states)
    if (pos.i < tokens.length && tokens[pos.i].type === 'rparen') {
      pos.i++ // consume )
    }
    return result
  }

  if (token.type === 'var') {
    pos.i++
    return resolveVar(token.name, states)
  }

  return false
}

// ─── Public API ────────────────────────────────────────────────────────────

export class SequenceEngine {
  /**
   * Load a sequence definition from a YAML file.
   */
  loadSequence(yamlPath: string): SequenceDefinition {
    const raw = readFileSync(yamlPath, 'utf-8')
    const data = yaml.load(raw) as SequenceDefinition
    if (!data.steps || !Array.isArray(data.steps)) {
      throw new Error(`Invalid sequence YAML: missing "steps" array`)
    }
    // Sort by day
    data.steps.sort((a, b) => a.day - b.day)
    return data
  }

  /**
   * Evaluate a condition string against channel states.
   * Empty/undefined condition = always true.
   */
  evaluateCondition(states: ChannelStates, condition?: string): boolean {
    if (!condition || condition.trim() === '') return true
    const tokens = tokenize(condition)
    const pos = { i: 0 }
    return parseOr(tokens, pos, states)
  }

  /**
   * Get the next step a lead should execute.
   * Returns null if the lead has completed the sequence or no step is ready.
   */
  getNextStep(
    state: LeadSequenceState,
    sequence: SequenceDefinition,
    daysSinceStart: number,
  ): SequenceStep | null {
    // Already completed or paused
    if (state.completedAt || state.pausedAt) return null

    // If any channel replied, sequence is complete
    if (state.channelStates.email.replied || state.channelStates.linkedin.replied) {
      return null
    }

    // If email bounced, skip remaining email steps but continue LinkedIn
    const emailBounced = state.channelStates.email.bounced

    for (let i = state.currentStepIndex; i < sequence.steps.length; i++) {
      const step = sequence.steps[i]

      // Not ready yet (day hasn't arrived)
      if (step.day > daysSinceStart) return null

      // Skip bounced email steps
      if (emailBounced && step.channel === 'email') continue

      // Evaluate condition
      if (!this.evaluateCondition(state.channelStates, step.condition)) continue

      return step
    }

    return null // sequence complete
  }

  /**
   * Calculate days since a lead's sequence started.
   */
  getDaysSinceStart(startedAt: string): number {
    const start = new Date(startedAt)
    const now = new Date()
    return Math.floor((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
  }
}

export const sequenceEngine = new SequenceEngine()
