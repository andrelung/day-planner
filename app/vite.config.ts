import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  // Read by app/src/lib/version.ts — the git commit/dirty half of the
  // version label comes from VITE_GIT_COMMIT/VITE_GIT_DIRTY instead (plain
  // env vars, not `define`, since those are only ever set at Docker build
  // time — see Dockerfile).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    // Lets `npm run dev` talk to a locally running backend (`npm run dev`
    // in server/) without CORS — cookies stay same-origin from the browser's
    // point of view. Production serves both from the one Express process,
    // so this proxy only matters for local frontend iteration.
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
    },
    // Bind every interface (not just localhost) so a phone on the same LAN,
    // or a tunnel like `ngrok http 5173`, can reach the dev server — see
    // "Testing on an iPhone" in the README. allowedHosts:true skips Vite's
    // Host-header check, which otherwise 403s any hostname it doesn't
    // recognize (LAN IPs, ngrok's random subdomains, etc.) — fine for a
    // local dev server with no real data behind it.
    host: true,
    allowedHosts: true,
  },
})
