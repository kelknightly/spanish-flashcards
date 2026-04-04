import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Disable the dev tools segment explorer — known crash in Next.js 15.5.x
  devIndicators: false,
}

export default nextConfig
