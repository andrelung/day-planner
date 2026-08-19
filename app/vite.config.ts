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
  },
})
