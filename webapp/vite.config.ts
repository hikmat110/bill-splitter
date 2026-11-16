import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveBuild, versionPlugin } from './plugins/version'

// Resolved once, then wired twice — into the bundle via `define` and onto disk
// via the plugin — so the running app and dist/version.json can never disagree.
const build = resolveBuild(new URL('../package.json', import.meta.url))

// Dev server proxies the API to the Bun server (src/server, default PORT 3000),
// so the browser sees a single origin and no CORS is involved. Adjust the target
// if you set a non-default PORT.
export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify(build) },
  plugins: [react(), versionPlugin(build)],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
})
