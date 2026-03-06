import { NextRequest, NextResponse } from 'next/server'
import { CampaignManager } from '@/lib/campaign/manager'

const manager = new CampaignManager()

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const { id, stepId } = await params

  try {
    const body = await req.json().catch(() => ({}))
    if (body.approved) {
      await manager.updateStepStatus(stepId, 'approved')
    }

    await manager.executeStep(id, stepId)

    const campaign = await manager.get(id)
    const step = campaign?.steps.find(s => s.id === stepId)

    return NextResponse.json({
      campaignId: id,
      stepId,
      status: step?.status ?? 'unknown',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
