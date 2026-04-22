// ─── Signal Detection — public API ──────────────────────────────────────────
export {
  addWatch,
  listWatches,
  removeWatch,
  detectSignal,
  runDetection,
  registerDetector,
  getDetector,
} from './engine'

export {
  loadTriggerConfig,
  executeTriggers,
  listTriggers,
  setTrigger,
} from './triggers'

export type {
  SignalWatch,
  DetectedSignal,
  SignalType,
  DetectorResult,
  TriggerAction,
  TriggerConfig,
  TriggerFile,
} from './types'

export {
  ALL_SIGNAL_TYPES,
  SIGNAL_CREDIT_COSTS,
  estimateDailyCreditCost,
} from './types'
