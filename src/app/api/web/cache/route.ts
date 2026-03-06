import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { webCache } from '@/lib/db/schema'
import type { CacheContentType } from '@/lib/web/types'

export async function GET() {
  const rows = await db.select().from(webCache)

  const stats = {
    totalEntries: rows.length,
    byContentType: {} as Record<string, number>,
    oldestEntry: rows.length > 0
      ? rows.reduce((oldest, r) => r.fetchedAt < oldest.fetchedAt ? r : oldest).fetchedAt
      : null,
    newestEntry: rows.length > 0
      ? rows.reduce((newest, r) => r.fetchedAt > newest.fetchedAt ? r : newest).fetchedAt
      : null,
  }

  for (const row of rows) {
    const ct = row.contentType ?? 'unknown'
    stats.byContentType[ct] = (stats.byContentType[ct] ?? 0) + 1
  }

  return NextResponse.json(stats)
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const contentType = searchParams.get('contentType') as CacheContentType | null

  if (contentType) {
    await db.delete(webCache).where(eq(webCache.contentType, contentType))
  } else {
    await db.delete(webCache)
  }

  return NextResponse.json({ cleared: true, contentType: contentType ?? 'all' })
}
