import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const ADMIN = process.env.E2E_ADMIN ?? 'root'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'boom123$'
const PASSWORD = 'Passw0rd!e2e'

interface Auth { accessToken: string; user: { id: string; email: string } }

/** Compte neuf à chaque exécution : les parcours ne dépendent jamais de l'état laissé par un autre. */
async function createAccount(request: APIRequestContext, name: string) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`
  const res = await request.post('/api/auth/register', { data: { email, password: PASSWORD, profileName: name } })
  expect(res.ok()).toBeTruthy()
  return { email, auth: (await res.json()) as Auth }
}

async function adminToken(request: APIRequestContext) {
  const res = await request.post('/api/auth/login', { data: { email: ADMIN, password: ADMIN_PASSWORD } })
  expect(res.ok(), 'connexion administrateur (E2E_ADMIN / E2E_ADMIN_PASSWORD)').toBeTruthy()
  return ((await res.json()) as Auth).accessToken
}

async function signInUI(page: Page, email: string) {
  await page.goto('/connexion')
  await page.getByLabel('Courriel ou identifiant', { exact: true }).fill(email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  // Nouvel appareil : le sélecteur de profils s'affiche, comme pour une vraie personne.
  await page.getByRole('button', { name: 'Regarder en tant que Camille' }).click()
}

/** Erreurs console et exceptions de la page : un parcours qui « passe » avec une exception cachée ne passe pas. */
function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(`exception: ${e.message}`))
  page.on('console', m => {
    if (m.type() !== 'error') return
    const text = m.text()
    if (/Failed to load resource.*(401|404)/.test(text)) return // 401 attendu avant refresh, 404 d'affiches optionnelles
    errors.push(text)
  })
  return errors
}

test.describe.configure({ mode: 'serial' })

test('inscription, choix du profil, accueil sans erreur', async ({ page, request }) => {
  const errors = watchErrors(page)
  const email = `e2e-${Date.now()}@test.local`
  await page.goto('/connexion')
  await page.getByRole('tab', { name: /Créer|Inscription/ }).click()
  await page.getByLabel('Courriel', { exact: true }).fill(email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Nom du premier profil').fill('Camille')
  await page.getByRole('button', { name: 'Créer mon compte' }).click()

  await expect(page.locator('.hero-title')).toBeVisible()
  await expect(page.getByRole('region', { name: /Nouveautés|Ajouts récents/i }).first()).toBeVisible()
  // Au démarrage, jamais de rangée vide ni de skeleton qui reste.
  await expect(page.locator('.skeleton')).toHaveCount(0)
  expect(errors).toEqual([])
  void request
})

test('fiche d\'un titre en fenêtre, fermeture au clavier, focus rendu', async ({ page, request }) => {
  const { email } = await createAccount(request, 'Camille')
  await signInUI(page, email)
  await expect(page.locator('.hero-title')).toBeVisible()
  const card = page.locator('.card-link').first()
  await card.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(card).toBeFocused()
})

test('lecture : la vidéo avance et la reprise est enregistrée', async ({ page, request }) => {
  const { email, auth } = await createAccount(request, 'Camille')
  await signInUI(page, email)
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox').fill('Marée basse')
  // Les titres arrivent du serveur après la saisie : on attend la ligne « titre », pas la ligne « demander à l'assistant ».
  await page.locator('[role="option"][data-kind="title"]', { hasText: 'Marée basse' }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^(Lecture|Reprendre)/ }).first().click()

  const video = page.locator('video')
  await expect(video).toBeVisible()
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 }).toBeGreaterThan(4) // le lecteur n'enregistre qu'au-delà de 2 s : pas de reprise pour un clic accidentel
  await page.mouse.move(720, 450) // les commandes se masquent à l'inactivité : un geste les ramène, comme pour une vraie personne
  await page.getByRole('button', { name: 'Retour' }).click()

  const profiles = await (await request.get('/api/profiles', { headers: { Authorization: `Bearer ${auth.accessToken}` } })).json() as { id: string }[]
  await expect.poll(async () => {
    const home = await (await request.get(`/api/home?profileId=${profiles[0]!.id}`, { headers: { Authorization: `Bearer ${auth.accessToken}` } })).json() as { rows: { type: string; items: { title: { name: string } }[] }[] }
    return home.rows.find(r => r.type === 'continue')?.items.map(i => i.title.name) ?? []
  }, { timeout: 15_000 }).toContain('Marée basse')
})

test('assistant : une demande libre renvoie des titres avec leur raison', async ({ page, request }) => {
  const { email } = await createAccount(request, 'Camille')
  await signInUI(page, email)
  await expect(page.locator('.hero-title')).toBeVisible()
  await page.keyboard.press('Control+j')
  const panel = page.getByRole('complementary', { name: 'Assistant' }).or(page.locator('.assistant'))
  await expect(panel).toBeVisible()
  await panel.getByLabel('Votre message à l\'assistant').fill('un drame court')
  await page.keyboard.press('Enter')
  await expect(panel.locator('.ac').first()).toBeVisible()
  await expect(panel.locator('.as-chips li').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
})

test('demande de titre : approuvée par un administrateur, notification en direct', async ({ page, request }) => {
  const { email } = await createAccount(request, 'Camille')
  await signInUI(page, email)
  await expect(page.locator('.hero-title')).toBeVisible()

  const name = `Nosferatu ${Date.now() % 10000}`
  await page.locator('.nav-avatar').click()
  await page.getByRole('menuitem', { name: 'Demander un titre' }).click()
  await page.locator('#rq-name').fill(name)
  await page.getByRole('button', { name: 'Envoyer la demande' }).click()
  await expect(page.getByText(name).first()).toBeVisible()
  await page.keyboard.press('Escape')

  const token = await adminToken(request)
  const admin = { Authorization: `Bearer ${token}` }
  const list = await (await request.get('/api/admin/requests', { headers: admin })).json() as { id: string; name: string }[]
  const mine = list.find(r => r.name === name)
  expect(mine, 'la demande doit arriver côté administration').toBeTruthy()
  const res = await request.put(`/api/admin/requests/${mine!.id}`, { headers: admin, data: { status: 'Approved' } })
  expect(res.ok()).toBeTruthy()

  // Poussé par SignalR : aucune actualisation de la page.
  await expect(page.getByRole('button', { name: /Notifications, 1 non lue/ })).toBeVisible({ timeout: 15_000 })
})

test('billet d\'aide : créé par l\'abonné, réponse du personnel reçue en direct', async ({ page, request }) => {
  const { email } = await createAccount(request, 'Camille')
  await signInUI(page, email)
  await expect(page.locator('.hero-title')).toBeVisible()

  await page.getByRole('button', { name: 'Ouvrir l\'aide' }).click()
  await page.getByRole('button', { name: 'Nouveau billet' }).click()
  await page.getByLabel('Sujet').fill('Lecture saccadée')
  await page.getByLabel('Message').fill('Ça saccade sur Ligne 9 depuis ce matin.')
  await page.locator('.sp').getByRole('button', { name: 'Envoyer' }).click()
  await expect(page.getByText('Ça saccade sur Ligne 9 depuis ce matin.')).toBeVisible()

  const token = await adminToken(request)
  const admin = { Authorization: `Bearer ${token}` }
  const tickets = await (await request.get('/api/admin/tickets', { headers: admin })).json() as { ticket: { id: string; subject: string }; requester: string }[]
  const ticket = tickets.find(t => t.requester === email)?.ticket
  expect(ticket).toBeTruthy()
  const reply = await request.post(`/api/support/tickets/${ticket!.id}/messages`, { headers: admin, data: { body: 'Nous regardons, merci du signalement.' } })
  expect(reply.ok()).toBeTruthy()

  await expect(page.getByText('Nous regardons, merci du signalement.')).toBeVisible({ timeout: 15_000 })
})

test('livre audio : le lecteur persistant continue pendant la navigation', async ({ page, request }) => {
  const { email } = await createAccount(request, 'Camille')
  await signInUI(page, email)
  await page.getByRole('link', { name: 'Livres audio' }).first().click()
  const card = page.locator('.card').first()
  await card.hover()
  await card.locator('.icon-btn.accent').click()
  await expect(page.locator('.dock')).toBeVisible()
  const time = () => page.evaluate(() => document.querySelector('audio')?.currentTime ?? 0)
  await expect.poll(time, { timeout: 15_000 }).toBeGreaterThan(1)

  await page.getByRole('link', { name: 'Accueil' }).first().click()
  const before = await time()
  await expect(page.locator('.dock')).toBeVisible()
  await expect.poll(time, { timeout: 10_000 }).toBeGreaterThan(before)
})

test('accessibilité de base : lien d\'évitement, un seul h1, repères', async ({ page, request }) => {
  const { email } = await createAccount(request, 'Camille')
  await signInUI(page, email)
  await expect(page.locator('.hero-title')).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused()
  await expect(page.locator('h1')).toHaveCount(1)
  await expect(page.getByRole('main')).toHaveCount(1)
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible()
})
