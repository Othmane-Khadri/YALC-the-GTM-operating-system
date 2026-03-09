import { NextRequest, NextResponse } from 'next/server'
import { CampaignManager } from '@/lib/campaign/manager'
import { db } from '@/lib/db'

const manager = new CampaignManager()

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') as Parameters<typeof manager.list>[0]

    const list = await manager.list(status || undefined)

    const result = list.map(c => ({
      ...c,
      progress: {
        completedSteps: c.steps.filter(s => s.status === 'completed').length,
        totalSteps: c.steps.length,
      },
    }))

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch campaigns'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (!body.title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }

    const campaign = await manager.create({
      conversationId: body.conversationId,
      title: body.title,
      hypothesis: body.hypothesis,
      targetSegment: body.targetSegment ?? null,
      channels: body.channels ?? [],
      successMetrics: body.successMetrics ?? [],
    })

    if (body.steps && Array.isArray(body.steps)) {
      await db.transaction(async (_tx) => {
        for (let i = 0; i < body.steps.length; i++) {
          const stepDef = body.steps[i]
          await manager.addStep(campaign.id, {
            stepIndex: i,
            skillId: stepDef.skillId,
            skillInput: stepDef.skillInput ?? {},
            channel: stepDef.channel ?? null,
            dependsOn: stepDef.dependsOn ?? [],
            approvalRequired: stepDef.approvalRequired ?? true,
          })
        }
      })
    }

    const full = await manager.get(campaign.id)
    return NextResponse.json(full, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create campaign'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
