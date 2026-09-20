import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiTarget = process.env.API_PROXY_TARGET || process.env.VITE_API_BASE_URL || 'http://localhost:3001'

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? '/rahatdisaster/' : '/',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
