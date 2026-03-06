import { runPatternDetection } from '@/lib/signals/scheduler'

export async function POST() {
  const result = await runPatternDetection()
  return Response.json(result)
}
