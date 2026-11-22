import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5555,
    strictPort: true,
    proxy: {
      // Talk to the FastAPI backend on 127.0.0.1:8000 without CORS.
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
