/**
 * Dedup Module — public API
 */

export { DedupEngine, normalizeLinkedInUrl, diceCoefficient } from './engine'
export { buildSuppressionSet } from './live-sync'
export { sendConfirmation, buildConfirmationBlocks, resolveTimeout } from './slack-confirm'
export type {
  LeadRecord,
  SuppressionEntry,
  SuppressionSource,
  DedupMatch,
  DedupResult,
  DedupConfig,
  DedupStatus,
  MatcherType,
  SlackConfirmAction,
  SlackConfirmResult,
} from './types'
export type { LiveSyncOptions } from './live-sync'
export type { SlackConfirmOptions } from './slack-confirm'
