/**
 * `calls:sync` CLI command — backfill recent Claap recordings into local
 * SQLite so orchestrator skills (cold email, qualifier, personalize) can
 * join against transcripts without a round-trip to the Claap API.
 */

import { and, eq } from 'drizzle-orm'
import { db } from '../../lib/db'
import { callRecordings, callTranscripts } from '../../lib/db/schema'
import { claapService } from '../../lib/services/claap'
import { resolveTenant } from '../../lib/tenant/index.js'

export interface CallsSyncOpts {
  lookbackDays?: number
  limit?: number
  tenant?: string
}

export interface CallsSyncResult {
  exitCode: number
  scanned: number
  ingested: number
  skipped: number
}

export async function runCallsSync(opts: CallsSyncOpts = {}): Promise<CallsSyncResult> {
  if (!claapService.isAvailable()) {
    console.error('CLAAP_API_KEY is not set. Add it to ~/.gtm-os/.env or your environment.')
    return { exitCode: 1, scanned: 0, ingested: 0, skipped: 0 }
  }

  const tenantId = resolveTenant({ cliFlag: opts.tenant })
  const lookbackDays = opts.lookbackDays ?? 7
  const since = new Date(Date.now() - lookbackDays * 86_400_000)

  const calls = await claapService.listCalls({ since, limit: opts.limit })
  console.log(`Claap: ${calls.length} calls in the last ${lookbackDays} days`)

  let ingested = 0
  let skipped = 0

  for (const call of calls) {
    const existing = await db
      .select()
      .from(callRecordings)
      .where(and(eq(callRecordings.provider, 'claap'), eq(callRecordings.providerCallId, call.id)))
      .limit(1)

    if (existing.length > 0) {
      skipped++
      continue
    }

    let transcript
    try {
      transcript = await claapService.getTranscript(call.id)
    } catch (err) {
      console.error(`  skip ${call.id}: transcript fetch failed (${(err as Error).message})`)
      skipped++
      continue
    }

    const recordingId = crypto.randomUUID()
    await db.insert(callRecordings).values({
      id: recordingId,
      tenantId,
      provider: 'claap',
      providerCallId: call.id,
      recordingUrl: call.recording_url ?? null,
      callTime: new Date(call.call_time),
      durationSec: call.duration_sec ?? 0,
      participantCount: call.participants?.length ?? 0,
      participants: call.participants ?? [],
    })

    await db.insert(callTranscripts).values({
      id: crypto.randomUUID(),
      callRecordingId: recordingId,
      text: transcript.text,
      summary: transcript.summary ?? null,
      moments: transcript.moments ?? [],
      language: transcript.language ?? 'en',
    })

    ingested++
  }

  console.log(`Ingested: ${ingested} · Skipped (already present or transcript missing): ${skipped}`)
  return { exitCode: 0, scanned: calls.length, ingested, skipped }
}
