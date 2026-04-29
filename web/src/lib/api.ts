/**
 * Typed fetch wrapper for the Hono /api/* surface.
 *
 * The bearer token (if configured server-side via GTM_OS_API_TOKEN) can
 * be supplied at runtime — for local dev the SPA proxies through Vite
 * and inherits the dev origin, so no token is needed unless the server
 * has one set.
 */

let bearerToken: string | undefined

export function setApiToken(token: string | undefined) {
  bearerToken = token
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: unknown,
  ) {
    super(`API ${status} ${statusText}`)
  }
}

function buildUrl(path: string, query?: ApiOptions['query']) {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, window.location.origin)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

export async function apiFetch<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = options
  const finalHeaders: Record<string, string> = {
    'content-type': 'application/json',
    ...(headers as Record<string, string> | undefined),
  }
  if (bearerToken) finalHeaders.authorization = `Bearer ${bearerToken}`

  const res = await fetch(buildUrl(path, query), {
    ...rest,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const contentType = res.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await res.json() : await res.text()

  if (!res.ok) {
    throw new ApiError(res.status, res.statusText, payload)
  }
  return payload as T
}

export const api = {
  get: <T = unknown>(path: string, query?: ApiOptions['query']) =>
    apiFetch<T>(path, { method: 'GET', query }),
  post: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body }),
  put: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body }),
  del: <T = unknown>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
}
