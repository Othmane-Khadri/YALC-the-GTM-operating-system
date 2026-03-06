import { NextRequest, NextResponse } from 'next/server'
import { ReviewQueue } from '@/lib/review/queue'

const queue = new ReviewQueue()

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const review = await queue.get(id)
  if (!review) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 })
  }
  return NextResponse.json(review)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()
  const { status, notes } = body as {
    status: 'approved' | 'rejected' | 'dismissed'
    notes?: string
  }

  try {
    let result
    switch (status) {
      case 'approved':
        result = await queue.approve(id, notes)
        break
      case 'rejected':
        result = await queue.reject(id, notes)
        break
      case 'dismissed':
        await queue.dismiss(id)
        result = { id, status: 'dismissed' }
        break
      default:
        return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 })
    }
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Not found'
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
