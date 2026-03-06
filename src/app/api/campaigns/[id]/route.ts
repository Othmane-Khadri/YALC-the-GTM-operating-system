import { NextRequest, NextResponse } from 'next/server'
import { CampaignManager } from '@/lib/campaign/manager'

const manager = new CampaignManager()

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const campaign = await manager.get(id)
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  const metrics = await manager.getMetrics(id)
  return NextResponse.json({ ...campaign, metrics })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()

  try {
    if (body.action === 'pause') {
      await manager.pause(id)
    } else if (body.action === 'resume') {
      await manager.resume(id)
    } else if (body.action === 'complete') {
      await manager.complete(id, body.verdict)
    } else {
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 })
    }

    const updated = await manager.get(id)
    return NextResponse.json(updated)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { db } = await import('@/lib/db')
  const { campaigns } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')

  await db.delete(campaigns).where(eq(campaigns.id, id))
  return NextResponse.json({ deleted: true })
}
