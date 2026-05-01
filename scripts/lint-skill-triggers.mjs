#!/usr/bin/env node
/**
 * Trigger-phrase conflict linter for `.claude/skills/`.
 *
 * Walks every `SKILL.md`, parses YAML frontmatter, extracts quoted trigger
 * phrases from the `description` field, and flags any pair of skills whose
 * trigger phrases collide via substring (case-insensitive, both directions).
 *
 * Opt-out per skill via frontmatter:
 *   trigger_overlap_allowed:
 *     - other-skill-name
 *
 * Exit codes:
 *   0 — no collisions
 *   1 — at least one collision (printed to stdout)
 *   2 — usage / IO error (printed to stderr)
 *
 * Usage:
 *   node scripts/lint-skill-triggers.mjs
 *   node scripts/lint-skill-triggers.mjs --skills-dir <path>
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const MIN_PHRASE_LENGTH = 6 // "for", "the", "a", and 5-char tokens are filtered out

function parseArgs(argv) {
  const args = { skillsDir: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--skills-dir') {
      args.skillsDir = argv[++i]
    } else if (a === '-h' || a === '--help') {
      args.help = true
    }
  }
  return args
}

function defaultSkillsDir() {
  // Resolve relative to repo root (this file lives at <root>/scripts/).
  const here = fileURLToPath(new URL('.', import.meta.url))
  return resolve(here, '..', '.claude', 'skills')
}

function readFrontmatter(filePath) {
  const raw = readFileSync(filePath, 'utf8')
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null
  try {
    return yaml.load(match[1])
  } catch (err) {
    throw new Error(`Failed to parse YAML frontmatter in ${filePath}: ${err.message}`)
  }
}

/**
 * Extract trigger phrases from a description.
 *
 * A trigger phrase is any double-quoted OR single-quoted run of >=MIN_PHRASE_LENGTH
 * characters. We accept both quote styles because authors sometimes wrap the
 * description in double quotes (forcing inner triggers to use single quotes)
 * and other times leave the description bare (so inner triggers use double
 * quotes). YAML normalisation already strips the outer wrapping for us.
 */
function extractTriggers(description) {
  if (!description || typeof description !== 'string') return []
  const out = new Set()
  const dq = /"([^"\n]{6,})"/g
  const sq = /'([^'\n]{6,})'/g
  for (const re of [dq, sq]) {
    let m
    while ((m = re.exec(description)) !== null) {
      const phrase = m[1].trim()
      if (phrase.length >= MIN_PHRASE_LENGTH) out.add(phrase)
    }
  }
  return [...out]
}

function loadSkills(skillsDir) {
  let entries
  try {
    entries = readdirSync(skillsDir)
  } catch (err) {
    throw new Error(`Cannot read skills dir ${skillsDir}: ${err.message}`)
  }
  const skills = []
  for (const entry of entries) {
    const full = join(skillsDir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    const skillFile = join(full, 'SKILL.md')
    let fm
    try {
      st = statSync(skillFile)
      if (!st.isFile()) continue
      fm = readFrontmatter(skillFile)
    } catch {
      continue
    }
    if (!fm) continue
    const name = fm.name || entry
    const triggers = extractTriggers(fm.description)
    const allowed = Array.isArray(fm.trigger_overlap_allowed)
      ? fm.trigger_overlap_allowed.map(String)
      : []
    skills.push({ name, file: skillFile, triggers, allowed })
  }
  // Stable order for deterministic output.
  skills.sort((a, b) => a.name.localeCompare(b.name))
  return skills
}

function findCollisions(skills) {
  const collisions = []
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const a = skills[i]
      const b = skills[j]
      if (a.allowed.includes(b.name) || b.allowed.includes(a.name)) continue
      for (const ta of a.triggers) {
        for (const tb of b.triggers) {
          const la = ta.toLowerCase()
          const lb = tb.toLowerCase()
          if (la === lb || la.includes(lb) || lb.includes(la)) {
            collisions.push({ a: a.name, ta, b: b.name, tb })
          }
        }
      }
    }
  }
  return collisions
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(
      'Usage: node scripts/lint-skill-triggers.mjs [--skills-dir <path>]\n',
    )
    return 0
  }
  const skillsDir = args.skillsDir ? resolve(args.skillsDir) : defaultSkillsDir()
  let skills
  try {
    skills = loadSkills(skillsDir)
  } catch (err) {
    process.stderr.write(`${err.message}\n`)
    return 2
  }
  const collisions = findCollisions(skills)
  if (collisions.length === 0) {
    process.stdout.write(
      `lint-skill-triggers: ${skills.length} skill(s), no trigger collisions.\n`,
    )
    return 0
  }
  for (const c of collisions) {
    process.stdout.write(
      `${c.a}:"${c.ta}" overlaps with ${c.b}:"${c.tb}"\n`,
    )
  }
  process.stdout.write(
    `\nlint-skill-triggers: ${collisions.length} collision(s) across ${skills.length} skill(s).\n`,
  )
  return 1
}

const code = main()
process.exit(code)
