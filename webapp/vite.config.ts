import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server proxies the API to the Bun server (src/server, default PORT 3000),
// so the browser sees a single origin and no CORS is involved. Adjust the target
// if you set a non-default PORT.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
})
