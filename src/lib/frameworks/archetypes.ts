/**
 * Archetype registry — the four owner archetypes shipped in 0.9.F.
 *
 * Every installed framework belongs to exactly one archetype (A/B/C/D).
 * The mapping is intentionally hard-coded: archetypes are spec-defined
 * in C1 and not user-extensible (a fifth archetype = a YALC version
 * bump, not a config tweak). New framework yaml files can join an
 * existing archetype by being added to `frameworks` below.
 */

export type ArchetypeId = 'a' | 'b' | 'c' | 'd'

export interface Archetype {
  id: ArchetypeId
  /** Canonical framework name owned by this archetype. */
  framework: string
  /** Sentence-cased title for SPA + CLI surfaces. */
  title: string
  /** One-line description shown on the dashboard page. */
  description: string
}

export const ARCHETYPES: Archetype[] = [
  {
    id: 'a',
    framework: 'competitor-audience-mining',
    title: 'Competitor Audience Mining',
    description:
      "Daily LinkedIn engagers from a tracked competitor, scored against your ICP and queued for approval.",
  },
  {
    id: 'b',
    framework: 'content-calendar-builder',
    title: 'Content Calendar Builder',
    description:
      "Weekly LinkedIn-trending + news mining drafts content ideas in your captured voice, gated for approval.",
  },
  {
    id: 'c',
    framework: 'outreach-campaign-builder',
    title: 'Outreach Campaign Builder',
    description:
      "On-demand wizard that turns a hypothesis into an ICP-matched LinkedIn or email sequence, gated before launch.",
  },
  {
    id: 'd',
    framework: 'lead-magnet-builder',
    title: 'Lead Magnet Builder',
    description:
      "On-demand wizard that proposes, outlines, renders, and (optionally) deploys a lead magnet for a buyer persona.",
  },
]

const BY_ID = new Map(ARCHETYPES.map((a) => [a.id, a]))
const BY_FRAMEWORK = new Map(ARCHETYPES.map((a) => [a.framework, a]))

/** Look up an archetype by its single-letter id. Returns null on miss. */
export function findArchetype(id: string): Archetype | null {
  return BY_ID.get(id.toLowerCase() as ArchetypeId) ?? null
}

/** Look up an archetype that owns a given framework name. */
export function archetypeForFramework(framework: string): Archetype | null {
  return BY_FRAMEWORK.get(framework) ?? null
}

/** True when `id` is one of the canonical archetype letters. */
export function isArchetypeId(id: string): id is ArchetypeId {
  return BY_ID.has(id.toLowerCase() as ArchetypeId)
}
