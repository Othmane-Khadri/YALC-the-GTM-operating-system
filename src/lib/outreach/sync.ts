import { randomUUID } from 'node:crypto'
import type { Client } from '@libsql/client'
import type { OutreachProvider, OutreachReadAdapter, ReadMessagePageResult } from './contracts'
import { HeyReachOutreachReadAdapter } from './adapters/heyreach'
import { InstantlyOutreachReadAdapter } from './adapters/instantly'
import { OutreachRepository } from './repository'
import { createProviderPacer, ProviderReadFailure, retryProviderRead, type ProviderPacer } from './rate-limit'
import { toSafeProviderError, type ProviderErrorCategory } from './errors'

const PROVIDERS = new Set<OutreachProvider>(['heyreach', 'instantly'])
const INCREMENTAL_OVERLAP_MS = 10 * 60_000

type Row = Record<string, unknown>

type ProviderRun = {
  id: string
  provider: OutreachProvider
  externalCampaignId: string
  senderAccountId: string | null
  syncCursor: string | null
  syncWatermark: string | null
}

type StoredCursor =
  | { mode: 'backfill'; offset?: number; startingAfter?: string | null }
  | { mode: 'incremental'; syncRunId: string; cursor: string | null }

type ProviderSummary = {
  state: 'completed' | 'failed'
  pages: number
  errorCode?: ProviderErrorCategory | 'interrupted'
  lastSuccessfulDataAt?: string | null
}

export interface SyncAdapterFactory {
  forProvider(run: {
    provider: OutreachProvider
    senderAccountId: string | null
    syncWatermark: string | null
  }): OutreachReadAdapter
}

export interface OutreachSyncCoordinatorOptions {
  raw: Client
  repository?: OutreachRepository
  adapters?: SyncAdapterFactory
  pacer?: ProviderPacer
  retryWait?: (ms: number) => Promise<void>
  now?: () => Date
  /** Tests set false and call drain() themselves. Production is asynchronous. */
  autoStart?: boolean
}

export type EnqueueSyncInput = {
  tenantId: string
  campaignId: string
  providers?: OutreachProvider[]
}

export type SafeSyncStatus = {
  id: string
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed'
  requestedProviders: OutreachProvider[]
  providerSummary: Record<string, ProviderSummary>
  counts: {
    pagesProcessed: number
    conversationsProcessed: number
    messagesProcessed: number
    malformedMessages: number
    identityConflicts: number
  }
  startedAt: string | null
  finishedAt: string | null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value ?? 0) || 0
}

function parseProviders(value: unknown): OutreachProvider[] {
  if (!Array.isArray(value)) return []
  return value.filter((provider): provider is OutreachProvider => typeof provider === 'string' && PROVIDERS.has(provider as OutreachProvider))
}

function parseStoredProviders(value: unknown): OutreachProvider[] {
  if (typeof value !== 'string') return []
  try {
    return parseProviders(JSON.parse(value))
  } catch {
    return []
  }
}

function parseSummary(value: unknown): Record<string, ProviderSummary> {
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, ProviderSummary>
      : {}
  } catch {
    return {}
  }
}

function isValidTimestamp(value: string | null): value is string {
  return value !== null && !Number.isNaN(Date.parse(value))
}

function overlapWatermark(value: string): string {
  return new Date(Date.parse(value) - INCREMENTAL_OVERLAP_MS).toISOString()
}

function readStoredCursor(value: string | null, provider: OutreachProvider, runId: string, watermark: string | null): StoredCursor {
  if (value) {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>
      if (parsed.mode === 'incremental' && typeof parsed.syncRunId === 'string' && (typeof parsed.cursor === 'string' || parsed.cursor === null)) {
        return { mode: 'incremental', syncRunId: parsed.syncRunId, cursor: parsed.cursor }
      }
      if (parsed.mode === 'backfill') {
        if (provider === 'heyreach' && Number.isSafeInteger(parsed.offset) && Number(parsed.offset) >= 0) return { mode: 'backfill', offset: Number(parsed.offset) }
        if (provider === 'instantly' && (typeof parsed.startingAfter === 'string' || parsed.startingAfter === null)) return { mode: 'backfill', startingAfter: parsed.startingAfter }
      }
    } catch {
      // Old/raw cursors are deliberately not trusted as a continuation token.
    }
  }
  if (isValidTimestamp(watermark)) return { mode: 'incremental', syncRunId: runId, cursor: null }
  return provider === 'heyreach' ? { mode: 'backfill', offset: 0 } : { mode: 'backfill', startingAfter: null }
}

function adapterCursor(cursor: StoredCursor, provider: OutreachProvider): string | null {
  if (cursor.mode === 'incremental') return cursor.cursor
  return provider === 'heyreach' ? String(cursor.offset ?? 0) : cursor.startingAfter ?? null
}

function storedNextCursor(cursor: StoredCursor, provider: OutreachProvider, nextCursor: string | null): string | null {
  if (nextCursor === null) return null
  if (cursor.mode === 'incremental') return JSON.stringify({ mode: 'incremental', syncRunId: cursor.syncRunId, cursor: nextCursor })
  return provider === 'heyreach'
    ? JSON.stringify({ mode: 'backfill', offset: Number(nextCursor) })
    : JSON.stringify({ mode: 'backfill', startingAfter: nextCursor })
}

const defaultAdapters: SyncAdapterFactory = {
  forProvider(run) {
    if (run.provider === 'heyreach') {
      return new HeyReachOutreachReadAdapter({ senderAccountId: run.senderAccountId, syncWatermark: run.syncWatermark })
    }
    return new InstantlyOutreachReadAdapter()
  },
}

/**
 * Durable, local coordinator. It accepts only exact local provider-run links,
 * has no provider write capability, and exposes a deterministic drain seam.
 */
export class OutreachSyncCoordinator {
  private readonly repository: OutreachRepository
  private readonly adapters: SyncAdapterFactory
  private readonly pacer: ProviderPacer
  private readonly retryWait: (ms: number) => Promise<void>
  private readonly now: () => Date
  private readonly autoStart: boolean

  constructor(private readonly options: OutreachSyncCoordinatorOptions) {
    this.repository = options.repository ?? new OutreachRepository(options.raw)
    this.adapters = options.adapters ?? defaultAdapters
    this.pacer = options.pacer ?? createProviderPacer()
    this.retryWait = options.retryWait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.now = options.now ?? (() => new Date())
    this.autoStart = options.autoStart ?? true
  }

  async enqueue(input: EnqueueSyncInput): Promise<string> {
    if (!input.tenantId.trim() || !input.campaignId.trim()) throw new Error('tenantId and campaignId are required')
    const providers: OutreachProvider[] = [...new Set(input.providers ?? ['heyreach', 'instantly'] as OutreachProvider[])]
    if (!providers.length || providers.some((provider) => !PROVIDERS.has(provider))) throw new Error('invalid providers')
    const id = randomUUID()
    await this.options.raw.execute({
      sql: `INSERT INTO outreach_sync_runs (id, tenant_id, campaign_id, requested_providers, status, provider_summary)
            SELECT ?, ?, ?, ?, 'queued', '{}' WHERE EXISTS (
              SELECT 1 FROM campaigns WHERE id = ? AND tenant_id = ?
            )`,
      args: [id, input.tenantId, input.campaignId, JSON.stringify(providers), input.campaignId, input.tenantId],
    })
    const exists = await this.options.raw.execute({ sql: 'SELECT id FROM outreach_sync_runs WHERE id = ? AND tenant_id = ?', args: [id, input.tenantId] })
    if (exists.rows.length === 0) throw new Error('campaign outside tenant')
    if (this.autoStart) queueMicrotask(() => { void this.drain(id) })
    return id
  }

  async drain(runId: string): Promise<void> {
    const startedAt = this.now().toISOString()
    const claimed = await this.options.raw.execute({
      sql: `UPDATE outreach_sync_runs SET status = 'running', started_at = ?, updated_at = datetime('now')
            WHERE id = ? AND status = 'queued'`,
      args: [startedAt, runId],
    })
    if (claimed.rowsAffected === 0) return

    const run = await this.getRun(runId)
    if (!run) return
    const providerRuns = await this.getProviderRuns(run.tenantId, run.campaignId, run.requestedProviders)
    const summary: Record<string, ProviderSummary> = {}
    let completed = 0
    let failed = 0

    for (const providerRun of providerRuns) {
      try {
        summary[providerRun.provider] = await this.syncProvider(run, providerRun)
        completed += 1
      } catch (error) {
        const safeError = error instanceof ProviderReadFailure ? error.safeError : toSafeProviderError(error)
        summary[providerRun.provider] = { state: 'failed', pages: 0, errorCode: safeError.category }
        await this.options.raw.execute({
          sql: `UPDATE campaign_provider_runs
                SET last_sync_failed_at = ?, last_error_code = ?, updated_at = datetime('now')
                WHERE id = ? AND tenant_id = ? AND campaign_id = ? AND provider = ?`,
          args: [this.now().toISOString(), safeError.category, providerRun.id, run.tenantId, run.campaignId, providerRun.provider],
        })
        failed += 1
      }
    }

    const finalStatus = failed === 0 && completed > 0 ? 'succeeded' : completed > 0 ? 'partial' : 'failed'
    await this.options.raw.execute({
      sql: `UPDATE outreach_sync_runs SET status = ?, provider_summary = ?, finished_at = ?, updated_at = datetime('now')
            WHERE id = ? AND tenant_id = ? AND campaign_id = ?`,
      args: [finalStatus, JSON.stringify(summary), this.now().toISOString(), runId, run.tenantId, run.campaignId],
    })
  }

  async recoverInterruptedRuns(): Promise<void> {
    const timestamp = this.now().toISOString()
    await this.options.raw.execute({
      sql: `UPDATE outreach_sync_runs
            SET status = 'failed', provider_summary = ?, finished_at = ?, updated_at = datetime('now')
            WHERE status = 'running'`,
      args: [JSON.stringify({ interrupted: { state: 'failed', pages: 0, errorCode: 'interrupted' } }), timestamp],
    })
  }

  async getStatus(tenantId: string, runId: string): Promise<SafeSyncStatus | null> {
    const result = await this.options.raw.execute({
      sql: `SELECT id, status, requested_providers, provider_summary, pages_processed, conversations_processed,
                   messages_processed, malformed_messages, identity_conflicts, started_at, finished_at
            FROM outreach_sync_runs WHERE id = ? AND tenant_id = ?`,
      args: [runId, tenantId],
    })
    const row = result.rows[0] as Row | undefined
    if (!row) return null
    const status = asString(row.status)
    return {
      id: String(row.id),
      status: status === 'succeeded' ? 'completed' : status === 'queued' || status === 'running' || status === 'partial' || status === 'failed' ? status : 'failed',
      requestedProviders: parseStoredProviders(row.requested_providers),
      providerSummary: parseSummary(row.provider_summary),
      counts: {
        pagesProcessed: asCount(row.pages_processed),
        conversationsProcessed: asCount(row.conversations_processed),
        messagesProcessed: asCount(row.messages_processed),
        malformedMessages: asCount(row.malformed_messages),
        identityConflicts: asCount(row.identity_conflicts),
      },
      startedAt: asString(row.started_at),
      finishedAt: asString(row.finished_at),
    }
  }

  private async syncProvider(run: { id: string; tenantId: string; campaignId: string }, providerRun: ProviderRun): Promise<ProviderSummary> {
    const adapter = this.adapters.forProvider(providerRun)
    let cursor = readStoredCursor(providerRun.syncCursor, providerRun.provider, run.id, providerRun.syncWatermark)
    const watermark = cursor.mode === 'incremental' && isValidTimestamp(providerRun.syncWatermark)
      ? overlapWatermark(providerRun.syncWatermark)
      : null
    let pages = 0

    while (true) {
      await this.pacer.wait(providerRun.provider)
      const page = await retryProviderRead({
        provider: providerRun.provider,
        wait: this.retryWait,
        read: () => adapter.readMessagePage({
          externalCampaignId: providerRun.externalCampaignId,
          cursor: adapterCursor(cursor, providerRun.provider),
          syncRunId: cursor.mode === 'incremental' ? cursor.syncRunId : null,
          watermark,
        }),
      })
      const persisted: ReadMessagePageResult = { ...page, nextCursor: storedNextCursor(cursor, providerRun.provider, page.nextCursor) }
      await this.repository.commitPage({
        tenantId: run.tenantId,
        campaignId: run.campaignId,
        providerRunId: providerRun.id,
        syncRunId: run.id,
        provider: providerRun.provider,
        page: persisted,
      })
      pages += 1
      if (page.nextCursor === null) break
      cursor = cursor.mode === 'incremental'
        ? { ...cursor, cursor: page.nextCursor }
        : providerRun.provider === 'heyreach'
          ? { mode: 'backfill', offset: Number(page.nextCursor) }
          : { mode: 'backfill', startingAfter: page.nextCursor }
    }

    const completedAt = this.now().toISOString()
    await this.options.raw.execute({
      sql: `UPDATE campaign_provider_runs
            SET sync_cursor = NULL, last_sync_succeeded_at = ?, last_error_code = NULL, updated_at = datetime('now')
            WHERE id = ? AND tenant_id = ? AND campaign_id = ? AND provider = ?`,
      args: [completedAt, providerRun.id, run.tenantId, run.campaignId, providerRun.provider],
    })
    const watermarkRow = await this.options.raw.execute({
      sql: 'SELECT sync_watermark FROM campaign_provider_runs WHERE id = ? AND tenant_id = ?',
      args: [providerRun.id, run.tenantId],
    })
    return { state: 'completed', pages, lastSuccessfulDataAt: asString((watermarkRow.rows[0] as Row | undefined)?.sync_watermark) }
  }

  private async getRun(id: string): Promise<{ id: string; tenantId: string; campaignId: string; requestedProviders: OutreachProvider[] } | null> {
    const result = await this.options.raw.execute({
      sql: 'SELECT id, tenant_id, campaign_id, requested_providers FROM outreach_sync_runs WHERE id = ?', args: [id],
    })
    const row = result.rows[0] as Row | undefined
    const campaignId = asString(row?.campaign_id)
    const tenantId = asString(row?.tenant_id)
    if (!row || !campaignId || !tenantId) return null
    const requestedProviders = parseStoredProviders(row.requested_providers)
    return { id: String(row.id), tenantId, campaignId, requestedProviders }
  }

  private async getProviderRuns(tenantId: string, campaignId: string, requested: OutreachProvider[]): Promise<ProviderRun[]> {
    const placeholders = requested.map(() => '?').join(', ')
    const result = await this.options.raw.execute({
      sql: `SELECT id, provider, external_campaign_id, sender_account_id, sync_cursor, sync_watermark
            FROM campaign_provider_runs
            WHERE tenant_id = ? AND campaign_id = ? AND provider IN (${placeholders})`,
      args: [tenantId, campaignId, ...requested],
    })
    return (result.rows as Row[]).flatMap((row) => {
      const provider = asString(row.provider)
      const id = asString(row.id)
      const externalCampaignId = asString(row.external_campaign_id)
      if (!provider || !PROVIDERS.has(provider as OutreachProvider) || !id || !externalCampaignId) return []
      return [{
        id,
        provider: provider as OutreachProvider,
        externalCampaignId,
        senderAccountId: asString(row.sender_account_id),
        syncCursor: asString(row.sync_cursor),
        syncWatermark: asString(row.sync_watermark),
      }]
    })
  }
}
