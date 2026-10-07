import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach } from 'vitest'
import { BrowsePage } from './pages/BrowsePage'
import { LoginPage } from './pages/LoginPage'
import { session } from './api'
import { mockApi, renderApp } from './test/helpers'

const title = (name: string, genre = 'Animation') => ({
  id: crypto.randomUUID(), name, synopsis: '', year: 2008, kind: 'Movie', genre, durationMinutes: 10, posterUrl: null, streamUrl: null,
})

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('LoginPage', () => {
  it('stocke la session après une connexion réussie', async () => {
    mockApi({ 'POST /api/auth/login': [200, { accessToken: 'AT', refreshToken: 'RT', user: { id: '1', email: 'a@b.c', role: 'Subscriber' } }] })
    renderApp(<LoginPage />)
    await userEvent.type(screen.getByLabelText(/Courriel/), 'a@b.c')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'Passw0rd!')
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    await waitFor(() => expect(session.get()).toEqual({ accessToken: 'AT', refreshToken: 'RT' }))
  })

  it("affiche l'erreur de l'API quand les identifiants sont invalides", async () => {
    mockApi({ 'POST /api/auth/login': [401, { error: 'Identifiants invalides.' }] })
    renderApp(<LoginPage />)
    await userEvent.type(screen.getByLabelText(/Courriel/), 'a@b.c')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'mauvaismdp')
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Identifiants invalides.')
    expect(session.get()).toBeNull()
  })

  it("bascule vers l'inscription et demande un nom de profil", async () => {
    renderApp(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: /Inscription/ }))
    expect(screen.getByLabelText('Nom du premier profil')).toBeInTheDocument()
  })
})

describe('BrowsePage', () => {
  it('affiche le catalogue et les genres', async () => {
    const items = [title('Sintel'), title('Tears of Steel', 'Science-fiction')]
    mockApi({ 'GET /api/titles': [200, { items, total: 2, page: 1, pageSize: 12 }] })
    renderApp(<BrowsePage />)
    expect(await screen.findByText('Sintel')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Science-fiction' })).toBeInTheDocument()
  })

  it('envoie la recherche à l’API après le délai anti-rebond', async () => {
    const calls = mockApi({ 'GET /api/titles': [200, { items: [], total: 0, page: 1, pageSize: 12 }] })
    renderApp(<BrowsePage />)
    await userEvent.type(screen.getByPlaceholderText(/Rechercher/), 'sin')
    expect(await screen.findByText('Aucun résultat.')).toBeInTheDocument()
    await waitFor(() => expect((fetch as ReturnType<typeof vi.fn>).mock.calls.some(([r]) => String(r.url).includes('q=sin'))).toBe(true))
    expect(calls.length).toBeGreaterThan(1)
  })
})
