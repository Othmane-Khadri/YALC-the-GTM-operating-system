import { getApifyToken } from './apify-token'

const POLL_INTERVAL_MS = 3000
const MAX_POLL_ATTEMPTS = 60 // 3 min max wait

export async function runApifyActor(
  actorId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const token = await getApifyToken()
  const authHeaders = { Authorization: `Bearer ${token}` }

  // 1. Start actor run
  // Apify REST API uses tilde (~) not slash (/) between username and actor name
  const apiActorId = actorId.replace('/', '~')
  const startRes = await fetch(
    `https://api.apify.com/v2/acts/${apiActorId}/runs`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(input),
    },
  )
  if (!startRes.ok) {
    const errText = await startRes.text()
    throw new Error(`Apify actor ${actorId} start failed (${startRes.status}): ${errText}`)
  }
  const runData = await startRes.json()
  const runId = runData.data?.id
  if (!runId) throw new Error(`Apify actor ${actorId} returned no run ID`)

  // 2. Poll for completion
  let status = runData.data?.status
  let attempts = 0
  while (status !== 'SUCCEEDED' && status !== 'FAILED' && status !== 'ABORTED') {
    if (attempts++ >= MAX_POLL_ATTEMPTS) {
      throw new Error(`Apify run timed out after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`)
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const pollRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
      headers: authHeaders,
    })
    if (!pollRes.ok) {
      throw new Error(`Apify poll failed (${pollRes.status}): ${await pollRes.text()}`)
    }
    const pollData = await pollRes.json()
    status = pollData.data?.status
  }

  if (status !== 'SUCCEEDED') {
    throw new Error(`Apify run ${status}: ${runId}`)
  }

  // 3. Fetch results from default dataset
  const datasetRes = await fetch(
    `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?format=json`,
    { headers: authHeaders },
  )
  if (!datasetRes.ok) {
    throw new Error(`Failed to fetch Apify dataset: ${datasetRes.status}`)
  }
  return await datasetRes.json()
}

export async function apifyHealthCheck(): Promise<{ ok: boolean; message: string }> {
  const token = process.env.APIFY_TOKEN
  if (!token) return { ok: false, message: 'APIFY_TOKEN not set' }
  try {
    const res = await fetch('https://api.apify.com/v2/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok
      ? { ok: true, message: 'Apify connection OK' }
      : { ok: false, message: `Apify auth failed: ${res.status}` }
  } catch (err) {
    return { ok: false, message: `Apify unreachable: ${err}` }
  }
}
