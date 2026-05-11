/**
 * Tests for /api/brain/section — in-place editor for /brain (C4).
 *
 * Drives a fake `~/.gtm-os/` live tree under a stubbed HOME, posts deep
 * path edits, and asserts:
 *   - YAML mutates only the targeted leaf,
 *   - other sections are untouched,
 *   - schema-violating values are rejected,
 *   - the sidecar `_meta.json#sections.<id>.confidence` flips to 1.0,
 *   - an audit log line is appended.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'

let TMP: string

function liveDir(): string {
  return join(TMP, '.gtm-os')
}

function seedLive() {
  const root = liveDir()
  mkdirSync(root, { recursive: true })
  // company_context.yaml — primary editable target.
  const companyContext = {
    company: { name: 'ACME', website: 'https://acme.test', description: 'desc' },
    founder: { name: 'Othmane', linkedin: 'https://linkedin.com/in/o' },
    icp: {
      segments_freeform: '',
      pain_points: ['x', 'y'],
      competitors: ['c1'],
      subreddits: ['r1'],
      target_communities: [],
    },
    voice: { description: 'v', examples_path: 'voice/examples.md' },
    sources: {},
    meta: {
      captured_at: '2026-04-29T00:00:00Z',
      last_updated_at: '2026-04-29T00:00:00Z',
      version: '0.6.0',
    },
  }
  writeFileSync(join(root, 'company_context.yaml'), yaml.dump(companyContext))
  writeFileSync(join(root, 'framework.yaml'), 'name: ACME GTM\n')
  mkdirSync(join(root, 'icp'), { recursive: true })
  writeFileSync(
    join(root, 'icp', 'segments.yaml'),
    yaml.dump({
      segments: [
        { id: 's1', name: 'SaaS founders', description: 'd' },
        { id: 's2', name: 'SDR teams', description: 'd2' },
      ],
    }),
  )
  // Pre-existing sidecar — set framework confidence to 0.5 so we can verify
  // editing icp doesn't touch framework's number.
  writeFileSync(
    join(root, '_meta.json'),
    JSON.stringify({
      sections: {
        framework: {
          confidence: 0.5,
          confidence_signals: {
            input_chars: 100,
            llm_self_rating: 5,
            has_metadata_anchors: false,
          },
        },
      },
    }),
  )
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-brain-section-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
})

async function postSection(body: unknown) {
  const { createApp } = await import('../lib/server/index')
  const app = createApp()
  return app.request('/api/brain/section', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/brain/section', () => {
  it('updates a deep path inside icp/segments.yaml without touching other files', async () => {
    seedLive()
    const beforeCompany = readFileSync(join(liveDir(), 'company_context.yaml'), 'utf-8')

    const res = await postSection({ path: 'icp.segments[0].name', value: 'New name' })
    expect(res.status).toBe(200)

    // icp/segments.yaml updated
    const icp = yaml.load(
      readFileSync(join(liveDir(), 'icp', 'segments.yaml'), 'utf-8'),
    ) as { segments: { name: string }[] }
    expect(icp.segments[0].name).toBe('New name')
    // Sibling untouched
    expect(icp.segments[1].name).toBe('SDR teams')

    // company_context.yaml unchanged byte-for-byte
    expect(readFileSync(join(liveDir(), 'company_context.yaml'), 'utf-8')).toBe(
      beforeCompany,
    )
  })

  it('updates a top-level company_context path and leaves icp untouched', async () => {
    seedLive()
    const beforeIcp = readFileSync(join(liveDir(), 'icp', 'segments.yaml'), 'utf-8')

    const res = await postSection({
      path: 'company_context.company.name',
      value: 'NewCo',
    })
    expect(res.status).toBe(200)

    const cc = yaml.load(
      readFileSync(join(liveDir(), 'company_context.yaml'), 'utf-8'),
    ) as { company: { name: string; website: string }; founder: { name: string } }
    expect(cc.company.name).toBe('NewCo')
    expect(cc.company.website).toBe('https://acme.test') // untouched
    expect(cc.founder.name).toBe('Othmane') // untouched

    expect(readFileSync(join(liveDir(), 'icp', 'segments.yaml'), 'utf-8')).toBe(
      beforeIcp,
    )
  })

  it('updates an array-of-strings field', async () => {
    seedLive()
    const res = await postSection({
      path: 'company_context.icp.pain_points',
      value: ['a', 'b', 'c'],
    })
    expect(res.status).toBe(200)
    const cc = yaml.load(
      readFileSync(join(liveDir(), 'company_context.yaml'), 'utf-8'),
    ) as { icp: { pain_points: string[] } }
    expect(cc.icp.pain_points).toEqual(['a', 'b', 'c'])
  })

  it('rejects unknown root section with 400', async () => {
    seedLive()
    const res = await postSection({ path: 'mystery.field', value: 'x' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('invalid_path')
  })

  it('rejects malformed path with 400', async () => {
    seedLive()
    const res = await postSection({ path: '', value: 'x' })
    expect(res.status).toBe(400)
  })

  it('rejects schema-violating value (string where object expected) with 400', async () => {
    seedLive()
    // company_context.company is required to be an object; replacing it with a
    // raw string violates the CompanyContext shape.
    const res = await postSection({
      path: 'company_context.company',
      value: 'not-an-object',
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('schema_violation')
  })

  it('rejects an object value missing required CompanyContext fields', async () => {
    seedLive()
    // Replacing the whole company_context root must keep the required keys.
    const res = await postSection({
      path: 'company_context',
      value: { company: { name: 'X' } }, // missing founder, icp, voice, sources, meta
    })
    expect(res.status).toBe(400)
  })

  it('flips the sidecar section confidence to 1.0 for the edited section', async () => {
    seedLive()
    const res = await postSection({
      path: 'icp.segments[0].name',
      value: 'Edited',
    })
    expect(res.status).toBe(200)
    const meta = JSON.parse(readFileSync(join(liveDir(), '_meta.json'), 'utf-8')) as {
      sections: Record<string, { confidence: number }>
    }
    expect(meta.sections.icp.confidence).toBe(1.0)
    // Pre-existing framework entry untouched.
    expect(meta.sections.framework.confidence).toBe(0.5)
  })

  it('appends an audit log entry with a hash but not the new value', async () => {
    seedLive()
    const auditPath = join(liveDir(), 'brain.audit.log')
    expect(existsSync(auditPath)).toBe(false)

    const secret = 'top-secret-new-value'
    const res = await postSection({
      path: 'icp.segments[0].name',
      value: secret,
    })
    expect(res.status).toBe(200)
    expect(existsSync(auditPath)).toBe(true)
    const log = readFileSync(auditPath, 'utf-8').trim()
    const lines = log.split('\n')
    expect(lines.length).toBe(1)
    // Format: ISO timestamp \t section path \t prior-hash:<hex>
    expect(lines[0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\t.+\tprior-hash:[0-9a-f]+$/,
    )
    expect(lines[0]).toContain('icp.segments[0].name')
    // Privacy: never log the new value.
    expect(lines[0]).not.toContain(secret)
  })

  it('does not call buildProfile or any synthesis path', async () => {
    seedLive()
    // If synthesis ran it would (a) take ages, (b) try to write under
    // _preview/. We simply assert _preview/ is never created.
    const res = await postSection({
      path: 'icp.segments[0].name',
      value: 'Edited',
    })
    expect(res.status).toBe(200)
    expect(existsSync(join(liveDir(), '_preview'))).toBe(false)
  })
})
