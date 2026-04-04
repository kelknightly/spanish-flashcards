import type { Metadata } from 'next'
import { Providers } from '@/components/Providers'
import { SparkleCanvas } from '@/components/SparkleCanvas'
import './globals.css'

export const metadata: Metadata = {
  title: 'Spanish Flashcards ✨',
  description: 'Narnia-powered Spanish vocabulary practice with SM-2 spaced repetition',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-brand-bg text-white antialiased">
        <div className="bg-animated min-h-screen">
          <Providers>
            {children}
          </Providers>
        </div>
        <SparkleCanvas />
      </body>
    </html>
  )
}
