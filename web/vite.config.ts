import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Pinned so the app doesn't drift to another port when other Vite
    // dev servers are running; fail loudly instead of auto-incrementing.
    port: 5199,
    strictPort: true,
  },
})
