import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { frameworks } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { GTMFramework } from '@/lib/framework/types'
import type { Learning } from '@/lib/framework/types'
import { IntelligenceStore } from '@/lib/intelligence/store'
import type { IntelligenceCategory, Evidence } from '@/lib/intelligence/types'

export async function POST(req: NextRequest) {
  try {
    const { patterns } = await req.json() as {
      patterns: Array<{
        insight: string
        confidence: 'hypothesis' | 'validated' | 'proven'
        segment?: string
        evidence_count: number
        category?: string
      }>
    }

    // Get current framework
    const [fw] = await db.select().from(frameworks)
      .where(eq(frameworks.userId, 'default'))
      .limit(1)

    if (!fw) {
      return Response.json({ error: 'No framework found' }, { status: 404 })
    }

    const framework = fw.data as GTMFramework

    // Convert patterns to Learning objects and append
    const newLearnings: Learning[] = patterns.map(p => ({
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      insight: p.insight,
      source: 'rlhf' as const,
      segment: p.segment || 'all',
      confidence: p.confidence,
    }))

    const updatedLearnings = [...(framework.learnings || []), ...newLearnings]
    const updatedFramework = {
      ...framework,
      learnings: updatedLearnings,
      lastUpdated: new Date().toISOString(),
    }

    await db.update(frameworks)
      .set({
        data: updatedFramework as unknown as null,
        updatedAt: new Date(),
      })
      .where(eq(frameworks.id, fw.id))

    // Also write to the structured intelligence system
    const store = new IntelligenceStore()
    let intelligenceErrors = 0
    for (const pattern of patterns) {
      try {
        const evidence: Evidence = {
          type: 'lead_outcome',
          sourceId: 'rlhf-review',
          metric: 'qualification_accuracy',
          value: pattern.confidence === 'proven' ? 0.9 : pattern.confidence === 'validated' ? 0.7 : 0.5,
          sampleSize: pattern.evidence_count,
          timestamp: new Date().toISOString(),
        }

        await store.add({
          category: (pattern.category as IntelligenceCategory) ?? 'qualification',
          insight: pattern.insight,
          evidence: [evidence],
          segment: pattern.segment ?? null,
          channel: null,
          confidence: 'hypothesis',
          source: 'rlhf',
          biasCheck: null,
          supersedes: null,
          validatedAt: null,
          expiresAt: null,
        })
      } catch {
        intelligenceErrors++
      }
    }

    return Response.json({
      saved: newLearnings.length,
      intelligenceCreated: patterns.length - intelligenceErrors,
      intelligenceErrors,
      frameworkUpdated: true,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to confirm learnings'
    return Response.json({ error: message }, { status: 500 })
  }
}
