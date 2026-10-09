import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  // Le proxy évite CORS en dev : le front appelle /api, Vite relaie vers l'API .NET.
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:5080', ws: true } } },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], globals: true },
})
