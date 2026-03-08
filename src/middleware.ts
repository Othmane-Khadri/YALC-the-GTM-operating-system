import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

// Routes that handle their own auth (or are public)
const PUBLIC_ROUTES = [
  '/login',
  '/api/auth', // NextAuth routes
  '/api/mcp-server', // has its own MCP_SERVER_TOKEN check
]

const isPublic = (pathname: string) =>
  PUBLIC_ROUTES.some(r => pathname.startsWith(r))

const isApiRoute = (pathname: string) => pathname.startsWith('/api/')

const isStaticAsset = (pathname: string) =>
  pathname.startsWith('/_next/') ||
  pathname.startsWith('/favicon') ||
  pathname.endsWith('.ico') ||
  pathname.endsWith('.svg')

let authWarningLogged = false

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const { timingSafeEqual } = require('crypto')
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export default auth((request) => {
  const { pathname } = request.nextUrl

  // Static assets — always allow
  if (isStaticAsset(pathname)) return NextResponse.next()

  // Public routes — always allow
  if (isPublic(pathname)) return NextResponse.next()

  // API routes — use existing token-based auth
  if (isApiRoute(pathname)) {
    const token = process.env.GTM_OS_API_TOKEN
    if (!token) {
      if (!authWarningLogged) {
        console.warn(
          '\x1b[33m[security]\x1b[0m GTM_OS_API_TOKEN is not set. ' +
          'All API routes are unprotected.'
        )
        authWarningLogged = true
      }
      return NextResponse.next()
    }

    const authHeader = request.headers.get('authorization')
    if (authHeader && safeCompare(authHeader, `Bearer ${token}`)) {
      return NextResponse.next()
    }

    const cookieToken = request.cookies.get('gtm-os-token')?.value
    if (cookieToken && safeCompare(cookieToken, token)) {
      return NextResponse.next()
    }

    // Also allow if user has a valid NextAuth session (browser requests)
    if (request.auth) return NextResponse.next()

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Page routes — require NextAuth session
  if (!request.auth) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
