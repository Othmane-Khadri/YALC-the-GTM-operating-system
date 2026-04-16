import { describe, it, expect } from 'vitest'
import {
  packEmbedding,
  unpackEmbedding,
  cosineSimilarity,
  readConfiguredProvider,
} from '../embeddings.js'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('embedding helpers', () => {
  it('pack/unpack round-trips exactly', () => {
    const v = new Float32Array([0.1, -0.5, 1.25, 3.14159, 0, -0])
    const blob = packEmbedding(v)
    const round = unpackEmbedding(blob)
    expect(round.length).toBe(v.length)
    for (let i = 0; i < v.length; i++) {
      expect(round[i]).toBeCloseTo(v[i], 6)
    }
  })

  it('unpack does not alias the input buffer', () => {
    const v = new Float32Array([1, 2, 3])
    const blob = packEmbedding(v)
    const round = unpackEmbedding(blob)
    round[0] = 99
    expect(v[0]).toBe(1) // original untouched
  })

  it('cosineSimilarity returns 1 for identical, 0 for orthogonal, -1 for opposite', () => {
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([1, 0, 0])
    const c = new Float32Array([0, 1, 0])
    const d = new Float32Array([-1, 0, 0])
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6)
    expect(cosineSimilarity(a, c)).toBeCloseTo(0, 6)
    expect(cosineSimilarity(a, d)).toBeCloseTo(-1, 6)
  })

  it('cosineSimilarity returns 0 for zero vectors', () => {
    const z = new Float32Array([0, 0, 0])
    const x = new Float32Array([1, 1, 1])
    expect(cosineSimilarity(z, x)).toBe(0)
  })

  it('cosineSimilarity throws on dimension mismatch', () => {
    expect(() =>
      cosineSimilarity(new Float32Array([1, 2]), new Float32Array([1, 2, 3])),
    ).toThrow(/dim mismatch/)
  })

  it('readConfiguredProvider defaults to voyage when no config file', () => {
    const home = mkdtempSync(join(tmpdir(), 'gtm-cfg-'))
    try {
      expect(readConfiguredProvider(home)).toBe('voyage')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('readConfiguredProvider honors explicit openai choice', () => {
    const home = mkdtempSync(join(tmpdir(), 'gtm-cfg-'))
    try {
      mkdirSync(join(home, '.gtm-os'))
      writeFileSync(
        join(home, '.gtm-os', 'config.yaml'),
        'memory:\n  embeddings:\n    provider: openai\n',
      )
      expect(readConfiguredProvider(home)).toBe('openai')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
