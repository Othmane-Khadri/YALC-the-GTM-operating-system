import type { Metadata } from 'next'
import { Space_Mono } from 'next/font/google'
import './globals.css'

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  variable: '--font-space-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Yalc — AI-Native GTM Operating System',
  description:
    'Open-source, AI-native operating system for running any GTM campaign. Describe your outcome, get a workflow.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={spaceMono.variable}>
      <body className="bg-background text-text-primary antialiased">
        {children}
      </body>
    </html>
  )
}
