import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createClient, type Client } from '@libsql/client'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as schema from '../../db/schema'

let raw: Client

const migrationNames = [
  '0000_bootstrap.sql',
  '0001_sticky_junta.sql',
  '0002_warm_liz_osborn.sql',
  '0003_multichannel_outreach_inbox.sql',
]

async function applyMigrations() {
  for (const name of migrationNames) {
    const migration = await readFile(
      resolve(process.cwd(), 'src/lib/db/migrations', name),
      'utf8',
    )
    const statements = migration
      .split(/-->\s*statement-breakpoint/)
      .map((statement) => statement.trim())
      .filter(Boolean)

    for (const statement of statements) await raw.execute(statement)
  }
}

async function columnNames(table: string) {
  const result = await raw.execute(`PRAGMA table_info(${table})`)
  return result.rows.map((row) => String(row.name))
}

async function foreignKeys(table: string) {
  const result = await raw.execute(`PRAGMA foreign_key_list(${table})`)
  return result.rows.map((row) => ({
    from: String(row.from),
    table: String(row.table),
    to: String(row.to),
  }))
}

async function indexColumns(table: string, name: string) {
  const result = await raw.execute(`PRAGMA index_info(${name})`)
  return result.rows.map((row) => String(row.name))
}

async function expectUniqueIndex(table: string, name: string, columns: string[]) {
  const result = await raw.execute(`PRAGMA index_list(${table})`)
  const index = result.rows.find((row) => row.name === name)
  expect(index?.unique).toBe(1)
  expect(await indexColumns(table, name)).toEqual(columns)
}

beforeEach(async () => {
  raw = createClient({ url: ':memory:' })
  await raw.execute('PRAGMA foreign_keys = ON')
  await applyMigrations()
})

afterEach(() => raw.close())

describe('outreach schema contract', () => {
  it('applies the additive, tenant-scoped multichannel inbox schema', async () => {
    expect(schema.campaignProviderRuns).toBeDefined()
    expect(schema.outreachIdentities).toBeDefined()
    expect(schema.outreachConversations).toBeDefined()
    expect(schema.outreachMessages).toBeDefined()
    expect(schema.outreachDrafts).toBeDefined()
    expect(schema.outreachSyncRuns).toBeDefined()

    expect(schema.campaignProviderRuns.provider.enumValues).toEqual(['heyreach', 'instantly'])
    expect(schema.outreachMessages.direction.enumValues).toEqual(['inbound', 'outbound'])

    await expect(raw.execute('SELECT 1 FROM campaign_provider_runs')).resolves.toBeDefined()
    await expect(raw.execute('SELECT 1 FROM outreach_identities')).resolves.toBeDefined()
    await expect(raw.execute('SELECT 1 FROM outreach_conversations')).resolves.toBeDefined()
    await expect(raw.execute('SELECT 1 FROM outreach_messages')).resolves.toBeDefined()
    await expect(raw.execute('SELECT 1 FROM outreach_drafts')).resolves.toBeDefined()
    await expect(raw.execute('SELECT 1 FROM outreach_sync_runs')).resolves.toBeDefined()

    await expect(columnNames('campaign_provider_runs')).resolves.toEqual(expect.arrayContaining([
      'tenant_id', 'campaign_id', 'provider', 'external_campaign_id', 'external_name',
      'sync_cursor', 'sync_watermark', 'last_sync_succeeded_at', 'last_error_code',
    ]))
    await expect(columnNames('outreach_identities')).resolves.toEqual(expect.arrayContaining([
      'tenant_id', 'campaign_id', 'campaign_lead_id', 'provider', 'identity_type',
      'external_identity_id', 'normalized_value', 'evidence_type',
    ]))
    await expect(columnNames('outreach_conversations')).resolves.toEqual(expect.arrayContaining([
      'tenant_id', 'campaign_lead_id', 'provider_run_id', 'provider', 'channel',
      'external_thread_id', 'provider_unread', 'provider_intent', 'last_message_at',
      'last_inbound_at', 'last_human_outbound_at', 'last_direction', 'last_message_kind',
      'first_seen_at', 'last_synced_at',
    ]))
    await expect(columnNames('outreach_messages')).resolves.toEqual(expect.arrayContaining([
      'tenant_id', 'outreach_conversation_id', 'provider', 'external_message_id',
      'fingerprint', 'direction', 'message_kind', 'subject', 'body_text',
      'provider_timestamp', 'imported_at',
    ]))
    await expect(columnNames('outreach_drafts')).resolves.toEqual(expect.arrayContaining([
      'tenant_id', 'campaign_lead_id', 'outreach_conversation_id', 'target_channel',
      'body_text', 'origin', 'status', 'created_at', 'updated_at',
    ]))
    await expect(columnNames('outreach_sync_runs')).resolves.toEqual(expect.arrayContaining([
      'tenant_id', 'campaign_id', 'requested_providers', 'status', 'provider_summary',
      'pages_processed', 'conversations_processed', 'messages_processed',
      'malformed_messages', 'identity_conflicts', 'started_at', 'finished_at',
    ]))

    expect(await foreignKeys('campaign_provider_runs')).toEqual(expect.arrayContaining([
      { from: 'tenant_id', table: 'campaigns', to: 'tenant_id' },
      { from: 'campaign_id', table: 'campaigns', to: 'id' },
    ]))
    expect(await foreignKeys('outreach_identities')).toEqual(expect.arrayContaining([
      { from: 'tenant_id', table: 'campaigns', to: 'tenant_id' },
      { from: 'campaign_id', table: 'campaigns', to: 'id' },
      { from: 'tenant_id', table: 'campaign_leads', to: 'tenant_id' },
      { from: 'campaign_lead_id', table: 'campaign_leads', to: 'id' },
    ]))
    expect(await foreignKeys('outreach_conversations')).toEqual(expect.arrayContaining([
      { from: 'tenant_id', table: 'campaign_leads', to: 'tenant_id' },
      { from: 'campaign_lead_id', table: 'campaign_leads', to: 'id' },
      { from: 'tenant_id', table: 'campaign_provider_runs', to: 'tenant_id' },
      { from: 'provider_run_id', table: 'campaign_provider_runs', to: 'id' },
    ]))
    expect(await foreignKeys('outreach_messages')).toEqual(expect.arrayContaining([
      { from: 'tenant_id', table: 'outreach_conversations', to: 'tenant_id' },
      { from: 'outreach_conversation_id', table: 'outreach_conversations', to: 'id' },
    ]))
    expect(await foreignKeys('outreach_drafts')).toEqual(expect.arrayContaining([
      { from: 'tenant_id', table: 'campaign_leads', to: 'tenant_id' },
      { from: 'campaign_lead_id', table: 'campaign_leads', to: 'id' },
      { from: 'tenant_id', table: 'outreach_conversations', to: 'tenant_id' },
      { from: 'outreach_conversation_id', table: 'outreach_conversations', to: 'id' },
    ]))
    expect(await foreignKeys('outreach_sync_runs')).toEqual(expect.arrayContaining([
      { from: 'tenant_id', table: 'campaigns', to: 'tenant_id' },
      { from: 'campaign_id', table: 'campaigns', to: 'id' },
    ]))

    await expectUniqueIndex(
      'campaign_provider_runs',
      'campaign_provider_runs_tenant_provider_external_idx',
      ['tenant_id', 'provider', 'external_campaign_id'],
    )
    await expectUniqueIndex(
      'outreach_identities',
      'outreach_identities_tenant_campaign_provider_type_value_idx',
      ['tenant_id', 'campaign_id', 'provider', 'identity_type', 'normalized_value'],
    )
    await expectUniqueIndex(
      'outreach_conversations',
      'outreach_conversations_tenant_provider_thread_idx',
      ['tenant_id', 'provider', 'external_thread_id'],
    )
    await expectUniqueIndex(
      'outreach_messages',
      'outreach_messages_tenant_provider_fingerprint_idx',
      ['tenant_id', 'provider', 'fingerprint'],
    )

    const campaignLeadColumns = await raw.execute('PRAGMA table_info(campaign_leads)')
    const inboxColumns = campaignLeadColumns.rows.filter((row) => [
      'inbox_state', 'snoozed_until', 'inbox_state_updated_at',
    ].includes(String(row.name)))
    expect(inboxColumns).toHaveLength(3)
    expect(inboxColumns.every((column) => column.notnull === 0)).toBe(true)

    await raw.execute({
      sql: 'INSERT INTO conversations (id, title) VALUES (?, ?)',
      args: ['conversation-a', 'Schema contract'],
    })
    await raw.execute({
      sql: `INSERT INTO campaigns (id, tenant_id, conversation_id, title, hypothesis, status, channels, success_metrics, metrics)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['campaign-a', 'tenant-a', 'conversation-a', 'Campaign A', 'Hypothesis', 'draft', 'linkedin', '{}', '{}'],
    })
    await raw.execute({
      sql: 'INSERT INTO conversations (id, title) VALUES (?, ?)',
      args: ['conversation-b', 'Schema contract B'],
    })
    await raw.execute({
      sql: `INSERT INTO campaigns (id, tenant_id, conversation_id, title, hypothesis, status, channels, success_metrics, metrics)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['campaign-b', 'tenant-b', 'conversation-b', 'Campaign B', 'Hypothesis', 'draft', 'email', '{}', '{}'],
    })
    await raw.execute({
      sql: 'INSERT INTO campaign_leads (id, tenant_id, campaign_id, provider_id) VALUES (?, ?, ?, ?)',
      args: ['lead-a', 'tenant-a', 'campaign-a', 'lead-a'],
    })
    await raw.execute({
      sql: 'INSERT INTO campaign_leads (id, tenant_id, campaign_id, provider_id) VALUES (?, ?, ?, ?)',
      args: ['lead-b', 'tenant-b', 'campaign-b', 'lead-b'],
    })
    const lead = await raw.execute(
      'SELECT inbox_state, snoozed_until, inbox_state_updated_at FROM campaign_leads WHERE id = ?',
      ['lead-a'],
    )
    expect(lead.rows[0]).toEqual({
      inbox_state: null,
      snoozed_until: null,
      inbox_state_updated_at: null,
    })

    await raw.execute({
      sql: `INSERT INTO campaign_provider_runs
            (id, tenant_id, campaign_id, provider, external_campaign_id, external_name)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: ['run-a', 'tenant-a', 'campaign-a', 'heyreach', 'external-campaign', 'Campaign'],
    })
    await expect(raw.execute({
      sql: `INSERT INTO campaign_provider_runs
            (id, tenant_id, campaign_id, provider, external_campaign_id, external_name)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: ['run-a-duplicate', 'tenant-a', 'campaign-a', 'heyreach', 'external-campaign', 'Campaign'],
    })).rejects.toThrow()
    await raw.execute({
      sql: `INSERT INTO campaign_provider_runs
            (id, tenant_id, campaign_id, provider, external_campaign_id, external_name)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: ['run-b', 'tenant-b', 'campaign-b', 'instantly', 'external-campaign', 'Campaign B'],
    })
    await raw.execute({
      sql: `INSERT INTO outreach_conversations
            (id, tenant_id, campaign_lead_id, provider_run_id, provider, channel, external_thread_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ['outreach-conversation-a', 'tenant-a', 'lead-a', 'run-a', 'heyreach', 'linkedin', 'thread-a'],
    })

    await expect(raw.execute({
      sql: `INSERT INTO campaign_provider_runs
            (id, tenant_id, campaign_id, provider, external_campaign_id, external_name)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: ['cross-run', 'tenant-b', 'campaign-a', 'heyreach', 'cross-run', 'Cross tenant'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: `INSERT INTO outreach_identities
            (id, tenant_id, campaign_id, campaign_lead_id, provider, identity_type, normalized_value, evidence_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['cross-identity', 'tenant-b', 'campaign-b', 'lead-a', 'instantly', 'email', 'cross@example.com', 'provider_payload'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: `INSERT INTO outreach_conversations
            (id, tenant_id, campaign_lead_id, provider_run_id, provider, channel, external_thread_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ['cross-conversation', 'tenant-b', 'lead-a', 'run-b', 'instantly', 'email', 'thread-cross'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: `INSERT INTO outreach_messages
            (id, tenant_id, outreach_conversation_id, provider, fingerprint, direction, message_kind, body_text, provider_timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['cross-message', 'tenant-b', 'outreach-conversation-a', 'heyreach', 'cross-fingerprint', 'inbound', 'human', 'Cross tenant', '2026-08-13T00:00:00Z'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: `INSERT INTO outreach_drafts
            (id, tenant_id, campaign_lead_id, outreach_conversation_id, target_channel, body_text, origin)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ['cross-draft', 'tenant-b', 'lead-b', 'outreach-conversation-a', 'email', 'Cross tenant', 'manual'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: 'INSERT INTO outreach_sync_runs (id, tenant_id, campaign_id, requested_providers) VALUES (?, ?, ?, ?)',
      args: ['cross-sync', 'tenant-b', 'campaign-a', '["instantly"]'],
    })).rejects.toThrow()

    await expect(raw.execute({
      sql: `INSERT INTO campaign_provider_runs
            (id, tenant_id, campaign_id, provider, external_campaign_id, external_name)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: ['invalid-run-provider', 'tenant-a', 'campaign-a', 'invalid', 'invalid-provider', 'Invalid'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: `INSERT INTO outreach_identities
            (id, tenant_id, campaign_id, campaign_lead_id, provider, identity_type, normalized_value, evidence_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['invalid-identity-provider', 'tenant-a', 'campaign-a', 'lead-a', 'invalid', 'email', 'invalid-provider@example.com', 'provider_payload'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: `INSERT INTO outreach_identities
            (id, tenant_id, campaign_id, campaign_lead_id, provider, identity_type, normalized_value, evidence_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['invalid-identity-type', 'tenant-a', 'campaign-a', 'lead-a', 'instantly', 'invalid', 'invalid-type@example.com', 'provider_payload'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: `INSERT INTO outreach_identities
            (id, tenant_id, campaign_id, campaign_lead_id, provider, identity_type, normalized_value, evidence_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['invalid-evidence-type', 'tenant-a', 'campaign-a', 'lead-a', 'instantly', 'email', 'invalid-evidence@example.com', 'invalid'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: `INSERT INTO outreach_conversations
            (id, tenant_id, campaign_lead_id, provider_run_id, provider, channel, external_thread_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ['invalid-conversation-provider', 'tenant-a', 'lead-a', 'run-a', 'invalid', 'linkedin', 'invalid-provider-thread'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: `INSERT INTO outreach_conversations
            (id, tenant_id, campaign_lead_id, provider_run_id, provider, channel, external_thread_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ['invalid-channel', 'tenant-a', 'lead-a', 'run-a', 'heyreach', 'invalid', 'invalid-channel-thread'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: `INSERT INTO outreach_conversations
            (id, tenant_id, campaign_lead_id, provider_run_id, provider, channel, external_thread_id, last_direction)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['invalid-last-direction', 'tenant-a', 'lead-a', 'run-a', 'heyreach', 'linkedin', 'invalid-last-direction-thread', 'invalid'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: `INSERT INTO outreach_conversations
            (id, tenant_id, campaign_lead_id, provider_run_id, provider, channel, external_thread_id, last_message_kind)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['invalid-last-kind', 'tenant-a', 'lead-a', 'run-a', 'heyreach', 'linkedin', 'invalid-last-kind-thread', 'invalid'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: `INSERT INTO outreach_messages
            (id, tenant_id, outreach_conversation_id, provider, fingerprint, direction, message_kind, body_text, provider_timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['invalid-message-provider', 'tenant-a', 'outreach-conversation-a', 'invalid', 'invalid-message-provider', 'inbound', 'human', 'Invalid', '2026-08-13T00:00:00Z'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: `INSERT INTO outreach_messages
            (id, tenant_id, outreach_conversation_id, provider, fingerprint, direction, message_kind, body_text, provider_timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['invalid-message-direction', 'tenant-a', 'outreach-conversation-a', 'heyreach', 'invalid-message-direction', 'invalid', 'human', 'Invalid', '2026-08-13T00:00:00Z'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: `INSERT INTO outreach_messages
            (id, tenant_id, outreach_conversation_id, provider, fingerprint, direction, message_kind, body_text, provider_timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['invalid-message-kind', 'tenant-a', 'outreach-conversation-a', 'heyreach', 'invalid-message-kind', 'inbound', 'invalid', 'Invalid', '2026-08-13T00:00:00Z'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: `INSERT INTO outreach_drafts
            (id, tenant_id, campaign_lead_id, target_channel, body_text, origin)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: ['invalid-draft-channel', 'tenant-a', 'lead-a', 'invalid', 'Invalid', 'manual'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: `INSERT INTO outreach_drafts
            (id, tenant_id, campaign_lead_id, target_channel, body_text, origin)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: ['invalid-draft-origin', 'tenant-a', 'lead-a', 'email', 'Invalid', 'invalid'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: `INSERT INTO outreach_drafts
            (id, tenant_id, campaign_lead_id, target_channel, body_text, origin, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ['invalid-draft-status', 'tenant-a', 'lead-a', 'email', 'Invalid', 'manual', 'invalid'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: 'INSERT INTO outreach_sync_runs (id, tenant_id, campaign_id, requested_providers, status) VALUES (?, ?, ?, ?, ?)',
      args: ['invalid-sync-status', 'tenant-a', 'campaign-a', '["heyreach"]', 'invalid'],
    })).rejects.toThrow()
    await expect(raw.execute({
      sql: 'UPDATE campaign_leads SET inbox_state = ? WHERE id = ?',
      args: ['invalid', 'lead-a'],
    })).rejects.toThrow()
  })
})
