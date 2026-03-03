import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'GTM-OS — AI-Native GTM Operating System',
  description:
    'Open-source, AI-native operating system for running any GTM campaign. Describe your outcome, get a workflow.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-text-primary antialiased">
        {children}
      </body>
    </html>
  )
}
