import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  base: '/asciirunner/',
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
