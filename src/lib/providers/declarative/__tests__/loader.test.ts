import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, utimesSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadDeclarativeManifests, resetDeclarativeLoaderCache } from '../loader'

const MANIFEST = `
manifestVersion: 1
capability: icp-company-search
provider: apollo
version: 0.1.0
auth:
  type: header
  name: X-Api-Key
  value: \${env:APOLLO_API_KEY}
endpoint:
  method: GET
  url: https://api.apollo.io/v1/list
response:
  rootPath: organizations
  mappings:
    "companies[].name": "$.name"
`

describe('loadDeclarativeManifests', () => {
  let dir: string
  beforeEach(() => {
    dir = join(tmpdir(), `yalc-decl-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    resetDeclarativeLoaderCache()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    resetDeclarativeLoaderCache()
  })

  it('returns no manifests when the directory is missing', () => {
    const out = loadDeclarativeManifests({ rootDir: join(dir, 'nope') })
    expect(out.manifests).toEqual([])
    expect(out.errors).toEqual([])
  })

  it('reads YAML files and compiles them', () => {
    writeFileSync(join(dir, 'apollo.yaml'), MANIFEST)
    const out = loadDeclarativeManifests({ rootDir: dir })
    expect(out.errors).toEqual([])
    expect(out.manifests).toHaveLength(1)
    expect(out.manifests[0].providerId).toBe('apollo')
  })

  it('records compile errors per file without crashing', () => {
    writeFileSync(join(dir, 'apollo.yaml'), MANIFEST)
    writeFileSync(join(dir, 'broken.yaml'), 'manifestVersion: 99\n')
    const out = loadDeclarativeManifests({ rootDir: dir })
    expect(out.manifests).toHaveLength(1)
    expect(out.errors).toHaveLength(1)
    expect(out.errors[0].source).toContain('broken.yaml')
  })

  it('memoizes compiled manifests by (source, mtime)', () => {
    const file = join(dir, 'apollo.yaml')
    writeFileSync(file, MANIFEST)
    const first = loadDeclarativeManifests({ rootDir: dir })
    const second = loadDeclarativeManifests({ rootDir: dir })
    expect(first.manifests[0]).toBe(second.manifests[0])
  })

  it('recompiles when mtime changes', () => {
    const file = join(dir, 'apollo.yaml')
    writeFileSync(file, MANIFEST)
    const first = loadDeclarativeManifests({ rootDir: dir })
    // Bump mtime by 5s
    const newTime = new Date(statSync(file).mtimeMs + 5000)
    utimesSync(file, newTime, newTime)
    const second = loadDeclarativeManifests({ rootDir: dir })
    expect(first.manifests[0]).not.toBe(second.manifests[0])
  })

  it('skips non-YAML files', () => {
    writeFileSync(join(dir, 'note.txt'), 'hello')
    writeFileSync(join(dir, 'apollo.yaml'), MANIFEST)
    const out = loadDeclarativeManifests({ rootDir: dir })
    expect(out.manifests).toHaveLength(1)
  })
})
