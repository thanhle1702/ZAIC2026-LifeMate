import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { liveBridgePlugin } from './server/liveBridge'
import { jobsPlugin } from './server/jobs'

export default defineConfig({
  plugins: [react(), tailwindcss(), jobsPlugin(fileURLToPath(new URL('..', import.meta.url))), liveBridgePlugin(fileURLToPath(new URL('..', import.meta.url)))],
  server: { port: 5173, strictPort: true },
})
