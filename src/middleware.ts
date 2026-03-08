import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

// Routes that handle their own auth (or are public)
const SELF_AUTHED_ROUTES = [
  '/api/mcp-server', // has its own MCP_SERVER_TOKEN check
]

// Static/page routes that should never be blocked
const isApiRoute = (pathname: string) => pathname.startsWith('/api/')

let authWarningLogged = false

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Only gate API routes
  if (!isApiRoute(pathname)) return NextResponse.next()

  // Skip routes that handle their own auth
  if (SELF_AUTHED_ROUTES.some(r => pathname.startsWith(r))) {
    return NextResponse.next()
  }

  const token = process.env.GTM_OS_API_TOKEN
  if (!token) {
    // No token configured — allow all requests (local dev without auth).
    if (!authWarningLogged) {
      console.warn(
        '\x1b[33m[security]\x1b[0m GTM_OS_API_TOKEN is not set. ' +
        'All API routes are unprotected. Set it in .env.local for production use: ' +
        'GTM_OS_API_TOKEN=$(openssl rand -hex 32)'
      )
      authWarningLogged = true
    }
    return NextResponse.next()
  }

  // Check Authorization header (constant-time comparison)
  const authHeader = request.headers.get('authorization')
  if (authHeader && safeCompare(authHeader, `Bearer ${token}`)) {
    return NextResponse.next()
  }

  // Check cookie fallback (for browser/frontend requests)
  const cookieToken = request.cookies.get('gtm-os-token')?.value
  if (cookieToken && safeCompare(cookieToken, token)) {
    return NextResponse.next()
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export const config = {
  matcher: '/api/:path*',
}
