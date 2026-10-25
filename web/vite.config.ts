import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// In `npm run dev`, calls to /api go to the local backend (cd server && npm run dev).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET || 'http://localhost:8787', changeOrigin: false },
    },
  },
})
