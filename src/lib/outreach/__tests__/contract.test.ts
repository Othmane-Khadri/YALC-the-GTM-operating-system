import { describe, expect, it } from 'vitest'
import * as ts from 'typescript'
import { resolve } from 'node:path'
import {
  type OutreachReadAdapter,
  type ReadMessagePageInput,
  type ReadMessagePageResult,
} from '../contracts'
import { toSafeProviderError } from '../errors'

function fakeAdapter(): OutreachReadAdapter {
  return {
    provider: 'heyreach',
    async discoverCampaigns() {
      return []
    },
    async readMessagePage(_input: ReadMessagePageInput): Promise<ReadMessagePageResult> {
      return {
        messages: [],
        nextCursor: null,
        normalization: { imported: 0, malformed: 0, mismatched: 0 },
      }
    },
  }
}

describe('outreach read adapter contract', () => {
  it('exposes only provider discovery and message page reads', () => {
    const adapter: OutreachReadAdapter = fakeAdapter()
    expect(Object.keys(adapter).sort()).toEqual(['discoverCampaigns', 'provider', 'readMessagePage'])
  })

  it('keeps provider readonly and rejects transport or write capabilities at compile time', () => {
    const fixture = resolve(
      process.cwd(),
      'src/lib/outreach/__tests__/fixtures/read-adapter-type-contract.fixture.ts',
    )
    const program = ts.createProgram({
      rootNames: [fixture],
      options: {
        target: ts.ScriptTarget.ES2017,
        lib: ['lib.esnext.d.ts'],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
    })
    const diagnostics = ts.getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))

    expect(diagnostics).toEqual([])
  })

  it('maps status-like failures to safe metadata without retaining sensitive input', () => {
    expect(toSafeProviderError({
      status: 429,
      retryAt: '2026-08-14T00:00:00Z',
      body: 'diego@example.com token=secret',
      url: 'https://provider.example/messages?api_key=secret',
    })).toEqual({
      category: 'rate_limited',
      status: 429,
      retryAt: '2026-08-14T00:00:00.000Z',
    })
    expect(toSafeProviderError({ status: 503, body: 'private response' }))
      .toEqual({ category: 'provider_unavailable', status: 503 })
    expect(toSafeProviderError({ retryAt: 'token=secret' }))
      .toEqual({ category: 'internal_error' })
  })
})
