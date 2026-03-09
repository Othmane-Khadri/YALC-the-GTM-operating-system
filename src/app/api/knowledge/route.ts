import { db } from '@/lib/db'
import { knowledgeItems } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')

    const items = type
      ? await db.select().from(knowledgeItems)
          .where(eq(knowledgeItems.type, type))
          .orderBy(sql`${knowledgeItems.createdAt} DESC`)
      : await db.select().from(knowledgeItems)
          .orderBy(sql`${knowledgeItems.createdAt} DESC`)

    return Response.json({ items })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch knowledge items'
    return Response.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const type = (formData.get('type') as string) || 'other'

  if (!file) {
    return Response.json({ error: 'No file provided' }, { status: 400 })
  }

  let extractedText = ''
  const ext = file.name.split('.').pop()?.toLowerCase()

  if (ext === 'md' || ext === 'txt' || ext === 'csv') {
    extractedText = await file.text()
  } else if (ext === 'pdf') {
    // Basic PDF support — store filename as marker
    extractedText = `[PDF file: ${file.name}]`
  } else {
    extractedText = await file.text()
  }

  // Cap extracted text at 100k chars
  if (extractedText.length > 100_000) {
    extractedText = extractedText.slice(0, 100_000)
  }

  const title = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')

  const [item] = await db.insert(knowledgeItems).values({
    title,
    type,
    fileName: file.name,
    extractedText,
    metadata: { fileSize: file.size, mimeType: file.type },
  }).returning()

  return Response.json(item, { status: 201 })
}
