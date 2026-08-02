import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Backend runs separately in dev (uvicorn on :8000); production serves both from one origin.
      '/api': 'http://localhost:8000',
    },
  },
})
