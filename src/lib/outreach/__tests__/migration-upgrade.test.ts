import { afterEach, describe, expect, it } from 'vitest'
import { createClient, type Client } from '@libsql/client'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

let raw: Client | null = null

async function apply(name: string) {
  const migration = await readFile(resolve(process.cwd(), 'src/lib/db/migrations', name), 'utf8')
  for (const statement of migration.split(/-->\s*statement-breakpoint/).map((value) => value.trim()).filter(Boolean)) {
    await raw!.execute(statement)
  }
}

afterEach(() => raw?.close())

describe('0004 outreach provider-run scope upgrade', () => {
  it('backfills existing 0003 messages and permits equal provider records in another campaign run', async () => {
    raw = createClient({ url: ':memory:' })
    await raw.execute('PRAGMA foreign_keys = ON')
    for (const migration of [
      '0000_bootstrap.sql',
      '0001_sticky_junta.sql',
      '0002_warm_liz_osborn.sql',
      '0003_multichannel_outreach_inbox.sql',
    ]) await apply(migration)

    await raw.execute({ sql: 'INSERT INTO conversations (id, title) VALUES (?, ?)', args: ['conversation-a', 'A'] })
    await raw.execute({ sql: 'INSERT INTO conversations (id, title) VALUES (?, ?)', args: ['conversation-b', 'B'] })
    for (const [campaignId, conversationId] of [['campaign-a', 'conversation-a'], ['campaign-b', 'conversation-b']] as const) {
      await raw.execute({
        sql: `INSERT INTO campaigns (id, tenant_id, conversation_id, title, hypothesis, status, channels, success_metrics, metrics)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [campaignId, 'tenant-a', conversationId, campaignId, 'Hypothesis', 'draft', 'email', '{}', '{}'],
      })
      await raw.execute({
        sql: 'INSERT INTO campaign_leads (id, tenant_id, campaign_id, provider_id) VALUES (?, ?, ?, ?)',
        args: [`lead-${campaignId}`, 'tenant-a', campaignId, `lead-${campaignId}`],
      })
      await raw.execute({
        sql: `INSERT INTO campaign_provider_runs (id, tenant_id, campaign_id, provider, external_campaign_id, external_name)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [`run-${campaignId}`, 'tenant-a', campaignId, 'instantly', `external-${campaignId}`, campaignId],
      })
    }
    await raw.execute({
      sql: `INSERT INTO outreach_conversations
            (id, tenant_id, campaign_lead_id, provider_run_id, provider, channel, external_thread_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ['conversation-outreach-a', 'tenant-a', 'lead-campaign-a', 'run-campaign-a', 'instantly', 'email', 'same-thread'],
    })
    await raw.execute({
      sql: `INSERT INTO outreach_messages
            (id, tenant_id, outreach_conversation_id, provider, external_message_id, fingerprint, direction, message_kind, body_text, provider_timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['message-a', 'tenant-a', 'conversation-outreach-a', 'instantly', 'same-message', 'same-fingerprint', 'inbound', 'human', 'Existing', '2026-08-13T10:00:00.000Z'],
    })

    await apply('0004_lucky_chat.sql')

    await expect(raw.execute('SELECT provider_run_id FROM outreach_messages WHERE id = ?', ['message-a']))
      .resolves.toMatchObject({ rows: [{ provider_run_id: 'run-campaign-a' }] })
    await raw.execute({
      sql: `INSERT INTO outreach_conversations
            (id, tenant_id, campaign_lead_id, provider_run_id, provider, channel, external_thread_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ['conversation-outreach-b', 'tenant-a', 'lead-campaign-b', 'run-campaign-b', 'instantly', 'email', 'same-thread'],
    })
    await raw.execute({
      sql: `INSERT INTO outreach_messages
            (id, tenant_id, outreach_conversation_id, provider_run_id, provider, external_message_id, fingerprint, direction, message_kind, body_text, provider_timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['message-b', 'tenant-a', 'conversation-outreach-b', 'run-campaign-b', 'instantly', 'same-message', 'same-fingerprint', 'inbound', 'human', 'Independent', '2026-08-13T10:00:00.000Z'],
    })

    await apply('0005_tricky_mandroid.sql')

    await expect(raw.execute('SELECT count(*) AS count FROM outreach_messages WHERE tenant_id = ?', ['tenant-a']))
      .resolves.toMatchObject({ rows: [{ count: 2 }] })
  })
})
