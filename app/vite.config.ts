import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
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
