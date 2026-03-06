import { NextRequest, NextResponse } from 'next/server'
import { ReviewQueue } from '@/lib/review/queue'

const queue = new ReviewQueue()

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || undefined
  const type = searchParams.get('type') || undefined
  const priority = searchParams.get('priority') || undefined
  const sourceSystem = searchParams.get('sourceSystem') || undefined

  const reviews = await queue.list({
    status: status as never,
    type: type as never,
    priority: priority as never,
    sourceSystem,
  })

  return NextResponse.json(reviews)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const review = await queue.create(body)
  return NextResponse.json(review, { status: 201 })
}
