import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))

// Construit le portail en mode démonstration : faux serveur en place, routage par hash, chemins relatifs, polices en data URI.
export default defineConfig({
  root: here,
  base: './',
  plugins: [
    react(),
    {
      name: 'demo-hash-router',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source === 'react-router-dom' && importer && !importer.includes('router-shim')) return resolve(here, 'router-shim.ts')
        if (source === '@microsoft/signalr') return resolve(here, '../src/realtime.ts')
        return null
      },
      // Seuls les caractères latins servent au français et à l'anglais : on retire les polices « latin-ext » (150 Ko de plus).
      transform(code, id) {
        if (!id.endsWith('fonts.css')) return null
        return code.replace(/@font-face\s*\{[^}]*latin-ext[^}]*\}/g, '')
      },
    },
  ],
  build: {
    outDir: resolve(here, '../dist/portal'),
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 400_000,   // polices et logos intégrés : aucune dépendance à un chemin de fichier
    chunkSizeWarningLimit: 900,
  },
})
