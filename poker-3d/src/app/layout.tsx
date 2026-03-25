import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'TV Casino - 3D Poker',
  description: 'Realistic 3D Texas Hold\'em Poker',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-black">{children}</body>
    </html>
  )
}
