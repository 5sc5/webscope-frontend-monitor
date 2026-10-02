import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.DASHBOARD_PORT || 5174),
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${Number(process.env.API_PORT || 3301)}` },
  },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
})
