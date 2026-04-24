import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  // Use root '/' for Vercel, and '/asciirunner/' for GitHub Pages
  base: process.env.VERCEL ? '/' : '/asciirunner/',
  server: {
    port: 5173,
    fs: {
      // Allow serving files from the parent directory (for seq/ folder)
      allow: [
        path.resolve(__dirname, '..'),
      ],
    },
  },
})
