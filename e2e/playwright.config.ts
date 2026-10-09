import { defineConfig } from '@playwright/test'

/**
 * Parcours de bout en bout contre une pile réelle : API .NET + PostgreSQL + front (Vite en dev).
 *
 *   E2E_BASE_URL         adresse du front (par défaut Vite en local ; en production, https://le-portail)
 *   E2E_ADMIN / E2E_ADMIN_PASSWORD   compte administrateur du seed (par défaut root / boom123$ en développement)
 *   E2E_CHROME           chemin d'un Chrome avec H.264 (le Chromium de Playwright ne lit pas les vidéos de démonstration)
 *
 * Aucun secret n'est écrit ici : le mot de passe par défaut n'existe qu'en développement (voir Seed:AdminPassword).
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.E2E_CHROME || undefined,
      args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run dev -w web-react',
    cwd: '..',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
