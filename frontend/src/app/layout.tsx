import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Macro Economics Tracker',
  description: 'AI-powered macro news tracker for asset managers',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
