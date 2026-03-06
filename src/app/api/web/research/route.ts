import { NextRequest, NextResponse } from 'next/server'
import { WebResearcher } from '@/lib/web/researcher'
import type { WebResearchRequest } from '@/lib/web/types'

const researcher = new WebResearcher()

export async function POST(req: NextRequest) {
  const body = (await req.json()) as WebResearchRequest

  if (!body.targetType || !body.targetIdentifier || !body.questions?.length) {
    return NextResponse.json(
      { error: 'Required fields: targetType, targetIdentifier, questions[]' },
      { status: 400 }
    )
  }

  try {
    const result = await researcher.research(body)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Research failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
