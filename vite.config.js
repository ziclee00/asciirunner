import { defineConfig } from 'vite'
import path from 'path'

// Vercel handles deployments via its own environment variables.
// If it's a Vercel deployment, the base should be '/', otherwise use '/asciirunner/' for GitHub Pages.
// We check for VERCEL_ENV or CI provided by common CI/CD tools.
const isVercel = process.env.VERCEL || process.env.VERCEL_ENV

export default defineConfig({
  base: isVercel ? '/' : '/asciirunner/',
  server: {
    port: 5173,
    fs: {
      allow: [
        path.resolve(__dirname, '..'),
      ],
    },
  },
  build: {
    // Ensure consistent output for Vercel
    outDir: 'dist',
  }
})
