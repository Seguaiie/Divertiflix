import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const ADMIN = process.env.E2E_ADMIN ?? 'root';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'boom123$';
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? 'http://127.0.0.1:4200';
const PASSWORD = 'Passw0rd!e2e';

interface Auth { accessToken: string; user: { id: string; email: string } }

async function register(request: APIRequestContext, prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const res = await request.post('/api/auth/register', { data: { email, password: PASSWORD, profileName: 'Camille' } });
  expect(res.ok()).toBeTruthy();
  return { email, auth: (await res.json()) as Auth };
}

async function adminAuth(request: APIRequestContext) {
  const res = await request.post('/api/auth/login', { data: { email: ADMIN, password: ADMIN_PASSWORD } });
  expect(res.ok(), 'connexion administrateur (E2E_ADMIN / E2E_ADMIN_PASSWORD)').toBeTruthy();
  return (await res.json()) as Auth;
}

async function backofficeLogin(page: Page, login: string, password: string) {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel('Identifiant').fill(login);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

async function portalLogin(page: Page, email: string) {
  await page.goto('/connexion');
  await page.getByLabel('Courriel ou identifiant', { exact: true }).fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('button', { name: 'Regarder en tant que Camille' }).click();
  await expect(page.locator('.hero-title')).toBeVisible();
}

/** Lien de la barre latérale (le tableau de bord contient d'autres liens aux mêmes noms). */
const go = (page: Page, name: string) => page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name });

test.describe.configure({ mode: 'serial' });

test('le back-office exige un compte du personnel', async ({ page, request }) => {
  const { email } = await register(request, 'abonne');
  await backofficeLogin(page, email, PASSWORD);
  await expect(page.getByRole('alert')).toContainText("n'a pas accès");
  await expect(page).toHaveURL(/\/login/);
});

test('tableau de bord : compteurs, services et navigation', async ({ page }) => {
  await backofficeLogin(page, ADMIN, ADMIN_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
  await expect(page.getByText('Demandes en attente')).toBeVisible();
  await expect(page.getByText('Base de données')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Utilisateurs' })).toBeVisible();
  // L'indicateur « en direct » prouve que la connexion SignalR du personnel est établie.
  await expect(page.getByRole('status').filter({ hasText: 'En direct' })).toBeVisible({ timeout: 15_000 });
});

test('catalogue : la recherche filtre le tableau', async ({ page }) => {
  await backofficeLogin(page, ADMIN, ADMIN_PASSWORD);
  await go(page, 'Catalogue').click();
  await expect(page.locator('tr.mat-mdc-row').first()).toBeVisible();
  await page.getByLabel('Rechercher un titre, un auteur, un genre').fill('Marée basse');
  await expect(page.locator('tr.mat-mdc-row')).toHaveCount(1);
  await expect(page.locator('tr.mat-mdc-row')).toContainText('Marée basse');
});

test("demande : approuvée dans le back-office, l'abonné est averti en direct dans le portail", async ({ browser, request }) => {
  const { email, auth } = await register(request, 'demande');
  const name = `Metropolis ${Date.now() % 100000}`;
  const created = await request.post('/api/requests', { headers: { Authorization: `Bearer ${auth.accessToken}` }, data: { name, kind: 'Movie', year: 1927 } });
  expect(created.ok()).toBeTruthy();

  const portal = await (await browser.newContext()).newPage();
  await portalLogin(portal, email);

  const staff = await (await browser.newContext()).newPage();
  await backofficeLogin(staff, ADMIN, ADMIN_PASSWORD);
  await go(staff, 'Demandes').click();
  const row = staff.locator('tr.mat-mdc-row', { hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Approuver' }).click();
  await expect(row.locator('.chip')).toContainText('Approuvée');

  await expect(portal.getByRole('button', { name: /Notifications, 1 non lue/ })).toBeVisible({ timeout: 15_000 });
});

test('billet : réponse depuis le back-office, visible en direct pour l\'abonné', async ({ browser, request }) => {
  const { email, auth } = await register(request, 'billet');
  const t = await request.post('/api/support/tickets', { headers: { Authorization: `Bearer ${auth.accessToken}` }, data: { subject: 'Sous-titres décalés', category: 'Playback', message: 'Les sous-titres arrivent trop tard.' } });
  expect(t.ok()).toBeTruthy();

  const portal = await (await browser.newContext()).newPage();
  await portalLogin(portal, email);
  await portal.getByRole('button', { name: 'Ouvrir l\'aide' }).click();
  await portal.getByText('Sous-titres décalés').click();
  await expect(portal.getByText('Les sous-titres arrivent trop tard.')).toBeVisible();

  const staff = await (await browser.newContext()).newPage();
  await backofficeLogin(staff, ADMIN, ADMIN_PASSWORD);
  await go(staff, "Billets d'aide").click();
  await staff.locator('tr.mat-mdc-row', { hasText: email }).getByRole('button', { name: 'Ouvrir' }).click();
  await staff.getByLabel('Votre réponse').fill('Corrigé côté serveur, merci.');
  await staff.getByRole('button', { name: 'Envoyer' }).click();
  await expect(staff.locator('.msg.staff')).toContainText('Corrigé côté serveur');

  await expect(portal.getByText('Corrigé côté serveur, merci.')).toBeVisible({ timeout: 15_000 });
});

test('rôle Support : pas de gestion des comptes, ni de décisions sur les demandes', async ({ page, request }) => {
  const admin = await adminAuth(request);
  const { email, auth } = await register(request, 'support');
  const promoted = await request.put(`/api/admin/users/${auth.user.id}`, { headers: { Authorization: `Bearer ${admin.accessToken}` }, data: { role: 'Support' } });
  expect(promoted.ok()).toBeTruthy();

  await backofficeLogin(page, email, PASSWORD);
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(nav.getByRole('link', { name: 'Catalogue' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Utilisateurs' })).toHaveCount(0);
  await page.goto(`${ADMIN_URL}/users`);
  await expect(page).toHaveURL(/dashboard/);
  await go(page, 'Demandes').click();
  await expect(page.getByRole('button', { name: 'Approuver' })).toHaveCount(0);
});
