import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Disable the dev tools segment explorer — known crash in Next.js 15.5.x
  devIndicators: false,
  // Allow large image payloads (base64 screenshots) in API routes
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
}

export default nextConfig
