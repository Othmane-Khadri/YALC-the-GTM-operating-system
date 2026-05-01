#!/usr/bin/env node
/**
 * validate.mjs — schema-validate every YAML under `providers/manifests/`.
 *
 * Walks `providers/manifests/<capability>/<provider>.yaml`, parses each
 * file with the `yaml` package, and validates against the canonical schema
 * at `src/lib/providers/declarative/schema.json` (the same one the runtime
 * compiler uses) via ajv. Exits 0 on green, 1 on any failure with a
 * per-file error report.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv from 'ajv'
import yaml from 'js-yaml'

const here = dirname(fileURLToPath(import.meta.url))
const PROVIDERS_ROOT = join(here, '..')
const REPO_ROOT = join(PROVIDERS_ROOT, '..')
const MANIFESTS = join(PROVIDERS_ROOT, 'manifests')
const SCHEMA_PATH = join(REPO_ROOT, 'src', 'lib', 'providers', 'declarative', 'schema.json')

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'))
const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(schema)

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else if (/\.ya?ml$/i.test(entry)) out.push(full)
  }
  return out
}

function main() {
  const files = walk(MANIFESTS)
  if (files.length === 0) {
    console.error('No manifests found under providers/manifests/.')
    process.exit(1)
  }

  let failed = 0
  for (const file of files) {
    const rel = relative(REPO_ROOT, file)
    const raw = readFileSync(file, 'utf-8')
    let parsed
    try {
      parsed = yaml.load(raw)
    } catch (err) {
      failed += 1
      console.error(`✗ ${rel}\n  yaml parse failed: ${err?.message ?? err}`)
      continue
    }
    if (!validate(parsed)) {
      failed += 1
      console.error(`✗ ${rel}`)
      for (const e of validate.errors ?? []) {
        console.error(`  ${e.instancePath || '/'} ${e.message ?? 'invalid'}`)
      }
      continue
    }
    const capDir = relative(MANIFESTS, file).split('/')[0]
    if (parsed.capability !== capDir) {
      failed += 1
      console.error(
        `✗ ${rel}\n  manifest capability "${parsed.capability}" does not match parent dir "${capDir}"`,
      )
      continue
    }
    const stem = relative(MANIFESTS, file).split('/').pop().replace(/\.ya?ml$/i, '')
    if (parsed.provider !== stem) {
      failed += 1
      console.error(
        `✗ ${rel}\n  manifest provider "${parsed.provider}" does not match filename "${stem}"`,
      )
      continue
    }
    console.log(`✓ ${rel}`)
  }

  if (failed > 0) {
    console.error(`\n${failed} manifest(s) failed validation.`)
    process.exit(1)
  }
  console.log(`\n${files.length} manifest(s) validated.`)
}

main()
