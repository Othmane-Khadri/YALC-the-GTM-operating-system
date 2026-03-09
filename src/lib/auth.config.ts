import Google from 'next-auth/providers/google'
import type { NextAuthConfig } from 'next-auth'

const allowedEmails = (process.env.ALLOWED_EMAILS ?? '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean)

export const authConfig: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false
      if (allowedEmails.length === 0) return true // no allowlist = allow all
      return allowedEmails.includes(user.email.toLowerCase())
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
}
