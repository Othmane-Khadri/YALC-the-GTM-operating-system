/**
 * Embeddings provider — Phase 1 / B3.
 *
 * ─── Vector storage decision ───────────────────────────────────────────
 * The installed `@libsql/client@0.17.0` does NOT expose a typed vector
 * column; native vector search on Turso requires the server-side
 * `F32_BLOB(N)` column type plus `vector_distance_cos()`, which are
 * Turso-server features not guaranteed in a local SQLite file. Rather
 * than ship a native dependency (sqlite-vss requires platform builds
 * and is fragile on darwin-arm64) we store embeddings as **packed
 * Float32Array BLOBs** and run brute-force cosine similarity in JS.
 *
 * At Phase-1 dogfood scale (dozens to low-thousands of nodes per tenant)
 * this is <20ms for a full sweep. When any tenant crosses ~10K nodes we
 * should revisit — options are:
 *   - sqlite-vss (native, fast, platform-specific build)
 *   - Turso remote DB with F32_BLOB + vector_distance_cos()
 *   - Re-introduce a columnar vector store (LanceDB / DuckDB-VSS)
 *
 * ─── Providers ─────────────────────────────────────────────────────────
 * Abstract `EmbeddingProvider` interface with two implementations:
 *   - VoyageEmbeddings  (voyage-3-large, 1024 dims, VOYAGE_API_KEY)
 *   - OpenAIEmbeddings  (text-embedding-3-large, 3072 dims, OPENAI_API_KEY)
 *
 * Selection is read from `~/.gtm-os/config.yaml → memory.embeddings.provider`
 * at call time. Default 'voyage' if unset. Missing key throws — no silent
 * mock fallback (matches Rule #2 of the GTM-OS contract).
 *
 * Batching: 100 inputs per API call. Callers pass any-length array.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import yaml from 'js-yaml'

export type EmbeddingModel = 'voyage-3-large' | 'text-embedding-3-large'
export type EmbeddingProviderName = 'voyage' | 'openai'

export interface EmbeddingResult {
  vector: Float32Array
  model: EmbeddingModel
  dims: number
}

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName
  readonly model: EmbeddingModel
  readonly dims: number
  /** Embed a batch. Result order matches input order. */
  embed(texts: string[]): Promise<EmbeddingResult[]>
}

const BATCH_SIZE = 100
// Rough heuristic: 1 token ≈ 4 chars of English.
const CHARS_PER_TOKEN = 4
// Free-tier fallback: 10K TPM, 3 RPM. We stay well under both on retry.
const FREE_TIER_TOKENS_PER_BATCH = 8000
const FREE_TIER_MS_BETWEEN_REQUESTS = 22_000
const MAX_429_RETRIES = 3

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

// ─── Voyage ───────────────────────────────────────────────────────────
class VoyageEmbeddings implements EmbeddingProvider {
  readonly name = 'voyage' as const
  readonly model: EmbeddingModel = 'voyage-3-large'
  readonly dims = 1024

  private readonly apiKey: string
  /** Sticky flag — once we see a free-tier 429, throttle all future calls. */
  private freeTierMode = false

  constructor() {
    const key = process.env.VOYAGE_API_KEY
    if (!key) {
      throw new Error(
        'VOYAGE_API_KEY missing. Set it in .env.local or switch memory.embeddings.provider to "openai" in ~/.gtm-os/config.yaml.',
      )
    }
    this.apiKey = key
  }

  /** Chunk by token budget when in free-tier mode, otherwise by BATCH_SIZE. */
  private chunk(texts: string[]): string[][] {
    if (!this.freeTierMode) {
      const out: string[][] = []
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        out.push(texts.slice(i, i + BATCH_SIZE))
      }
      return out
    }
    const out: string[][] = []
    let cur: string[] = []
    let curTokens = 0
    for (const t of texts) {
      const tk = Math.ceil(t.length / CHARS_PER_TOKEN)
      if (curTokens + tk > FREE_TIER_TOKENS_PER_BATCH && cur.length > 0) {
        out.push(cur)
        cur = []
        curTokens = 0
      }
      cur.push(t)
      curTokens += tk
    }
    if (cur.length > 0) out.push(cur)
    return out
  }

  private async postBatch(batch: string[]): Promise<EmbeddingResult[]> {
    let attempt = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ input: batch, model: this.model }),
      })
      if (res.ok) {
        const json = (await res.json()) as { data: Array<{ embedding: number[] }> }
        return json.data.map((row) => ({
          vector: new Float32Array(row.embedding),
          model: this.model,
          dims: this.dims,
        }))
      }
      if (res.status === 429 && attempt < MAX_429_RETRIES) {
        const body = await res.text().catch(() => '')
        const isFreeTier =
          body.includes('payment method') ||
          body.includes('reduced rate limits') ||
          body.includes('10K TPM')
        if (isFreeTier && !this.freeTierMode) {
          // eslint-disable-next-line no-console
          console.warn(
            '[embeddings][voyage] free-tier detected (3 RPM / 10K TPM). Throttling client-side. Add billing at https://dash.voyageai.com to unlock standard limits.',
          )
          this.freeTierMode = true
          // Bail out of this batch and let the caller re-chunk with token budget.
          throw new FreeTierRetryError()
        }
        const backoffMs = FREE_TIER_MS_BETWEEN_REQUESTS
        // eslint-disable-next-line no-console
        console.warn(
          `[embeddings][voyage] 429 — backing off ${backoffMs}ms (attempt ${attempt + 1}/${MAX_429_RETRIES})`,
        )
        await sleep(backoffMs)
        attempt++
        continue
      }
      const body = await res.text().catch(() => '')
      throw new Error(`Voyage embeddings API ${res.status}: ${body.slice(0, 300)}`)
    }
  }

  async embed(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return []
    const out: EmbeddingResult[] = []
    let batches = this.chunk(texts)
    let i = 0
    while (i < batches.length) {
      const batch = batches[i]
      try {
        const results = await this.postBatch(batch)
        for (const r of results) out.push(r)
        i++
        if (this.freeTierMode && i < batches.length) {
          await sleep(FREE_TIER_MS_BETWEEN_REQUESTS)
        }
      } catch (err) {
        if (err instanceof FreeTierRetryError) {
          // Re-chunk all remaining texts with the new token budget.
          const remaining: string[] = []
          for (let j = i; j < batches.length; j++) remaining.push(...batches[j])
          batches = [
            ...batches.slice(0, i),
            ...this.chunk(remaining),
          ]
          continue
        }
        throw err
      }
    }
    return out
  }
}

class FreeTierRetryError extends Error {
  constructor() {
    super('voyage-free-tier-retry')
  }
}

// ─── OpenAI ───────────────────────────────────────────────────────────
class OpenAIEmbeddings implements EmbeddingProvider {
  readonly name = 'openai' as const
  readonly model: EmbeddingModel = 'text-embedding-3-large'
  readonly dims = 3072

  private readonly apiKey: string

  constructor() {
    const key = process.env.OPENAI_API_KEY
    if (!key) {
      throw new Error(
        'OPENAI_API_KEY missing. Set it in .env.local or switch memory.embeddings.provider to "voyage" in ~/.gtm-os/config.yaml.',
      )
    }
    this.apiKey = key
  }

  async embed(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return []
    const out: EmbeddingResult[] = []
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE)
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ input: batch, model: this.model }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`OpenAI embeddings API ${res.status}: ${body.slice(0, 200)}`)
      }
      const json = (await res.json()) as { data: Array<{ embedding: number[] }> }
      for (const row of json.data) {
        out.push({
          vector: new Float32Array(row.embedding),
          model: this.model,
          dims: this.dims,
        })
      }
    }
    return out
  }
}

// ─── Provider selection ───────────────────────────────────────────────

let cachedProvider: EmbeddingProvider | null = null
let cachedProviderName: EmbeddingProviderName | null = null

/**
 * Read `~/.gtm-os/config.yaml → memory.embeddings.provider`.
 * Returns 'voyage' if the file or key is missing.
 */
export function readConfiguredProvider(home = homedir()): EmbeddingProviderName {
  const configPath = join(home, '.gtm-os', 'config.yaml')
  if (!existsSync(configPath)) return 'voyage'
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const cfg = yaml.load(raw) as
      | { memory?: { embeddings?: { provider?: EmbeddingProviderName } } }
      | null
    const p = cfg?.memory?.embeddings?.provider
    if (p === 'voyage' || p === 'openai') return p
    return 'voyage'
  } catch {
    return 'voyage'
  }
}

export function getEmbeddingProvider(): EmbeddingProvider {
  const configured = readConfiguredProvider()
  if (cachedProvider && cachedProviderName === configured) return cachedProvider
  cachedProvider = configured === 'openai' ? new OpenAIEmbeddings() : new VoyageEmbeddings()
  cachedProviderName = configured
  return cachedProvider
}

/** Test hook — resets the cached provider so a new config takes effect. */
export function resetEmbeddingProviderCache(): void {
  cachedProvider = null
  cachedProviderName = null
}

// ─── BLOB packing / cosine math ───────────────────────────────────────

/** Pack a Float32Array into a Node Buffer for SQLite BLOB storage. */
export function packEmbedding(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

/** Unpack a SQLite BLOB back into a Float32Array. */
export function unpackEmbedding(blob: Buffer | Uint8Array): Float32Array {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob)
  // Copy to a fresh ArrayBuffer so we don't alias Buffer's shared pool.
  const copy = new ArrayBuffer(buf.byteLength)
  new Uint8Array(copy).set(buf)
  return new Float32Array(copy)
}

/** Cosine similarity in [-1, 1]. Zero vectors return 0. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: dim mismatch ${a.length} vs ${b.length}`)
  }
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
