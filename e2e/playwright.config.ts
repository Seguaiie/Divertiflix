import { defineConfig } from '@playwright/test'

/**
 * Parcours de bout en bout contre une pile réelle : API .NET + PostgreSQL + front (Vite en dev).
 *
 *   E2E_BASE_URL         adresse du portail (par défaut Vite en local ; en production, https://le-portail)
 *   E2E_ADMIN_URL        adresse du back-office Angular (par défaut ng serve en local ; en production, https://le-portail/admin)
 *   E2E_ADMIN / E2E_ADMIN_PASSWORD   compte administrateur du seed (par défaut root / boom123$ en développement)
 *   E2E_CHROME           chemin d'un Chrome avec H.264 (le Chromium de Playwright ne lit pas les vidéos de démonstration)
 *
 * Aucun secret n'est écrit ici : le mot de passe par défaut n'existe qu'en développement (voir Seed:AdminPassword).
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173'
const adminURL = process.env.E2E_ADMIN_URL ?? 'http://127.0.0.1:4200'

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
  // Les serveurs de développement ne sont lancés que si aucune adresse n'est fournie ; l'API .NET et PostgreSQL restent à démarrer.
  webServer: process.env.E2E_BASE_URL ? undefined : [
    { command: 'npm run dev -w web-react', cwd: '..', url: baseURL, reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm start -w admin-angular -- --host 127.0.0.1', cwd: '..', url: adminURL, reuseExistingServer: true, timeout: 120_000 },
  ],
})
