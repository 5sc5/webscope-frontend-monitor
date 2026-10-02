import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@webscope/monitor-sdk': fileURLToPath(new URL('../../packages/monitor-sdk/src/index.ts', import.meta.url)) } },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PLAYGROUND_PORT || 5175),
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT || 3301}` },
  },
})
