import { NextResponse } from 'next/server'
import NextAuth from 'next-auth'
import { authConfig } from '@/lib/auth.config'

const { auth } = NextAuth(authConfig)

// Routes that handle their own auth (or are public)
const PUBLIC_ROUTES = [
  '/login',
  '/api/auth', // NextAuth routes
  '/api/mcp-server', // has its own MCP_SERVER_TOKEN check
]

const isPublic = (pathname: string) =>
  PUBLIC_ROUTES.some(r => pathname.startsWith(r))

const isApiRoute = (pathname: string) => pathname.startsWith('/api/')

// Constant-time string comparison (Edge-compatible, no Node crypto needed)
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

export default auth((request) => {
  const { pathname } = request.nextUrl

  // Public routes — always allow
  if (isPublic(pathname)) return NextResponse.next()

  // Authenticated via NextAuth session — allow everything
  if (request.auth) return NextResponse.next()

  // API routes — also accept token-based auth (for external clients)
  if (isApiRoute(pathname)) {
    const token = process.env.GTM_OS_API_TOKEN
    if (!token) return NextResponse.next() // no token = open (local dev)

    const authHeader = request.headers.get('authorization')
    if (authHeader && safeCompare(authHeader, `Bearer ${token}`)) {
      return NextResponse.next()
    }

    const cookieToken = request.cookies.get('gtm-os-token')?.value
    if (cookieToken && safeCompare(cookieToken, token)) {
      return NextResponse.next()
    }

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Page routes without session — redirect to login
  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('callbackUrl', pathname)
  return NextResponse.redirect(loginUrl)
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
