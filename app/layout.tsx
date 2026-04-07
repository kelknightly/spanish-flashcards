import type { Metadata } from 'next'
import { Providers } from '@/components/Providers'
import { SparkleCanvas } from '@/components/SparkleCanvas'
import { SparkleProvider } from '@/contexts/SparkleContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import './globals.css'

export const metadata: Metadata = {
  title: 'Spanish Flashcards ✨',
  description: 'Narnia-powered Spanish vocabulary practice with SM-2 spaced repetition',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🦁</text></svg>",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-brand-bg text-white antialiased">
        <SparkleProvider>
          <ThemeProvider>
            <div className="bg-animated min-h-screen">
              <Providers>
                {children}
                <SparkleCanvas />
              </Providers>
            </div>
          </ThemeProvider>
        </SparkleProvider>
      </body>
    </html>
  )
}
