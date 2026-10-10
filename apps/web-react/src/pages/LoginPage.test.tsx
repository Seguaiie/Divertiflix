import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { makeSession, mockApi, renderApp } from '../test/utils'
import { LoginPage } from './LoginPage'

describe('LoginPage', () => {
  it('connecte et enregistre la session', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi({ 'POST /api/auth/login': makeSession() })
    renderApp(<LoginPage />)
    await user.type(screen.getByLabelText('Courriel ou identifiant'), '  camille@test.com ')
    await user.type(screen.getByLabelText('Mot de passe'), 'Passw0rd!')
    await user.click(screen.getByRole('button', { name: 'Se connecter' }))
    await waitFor(() => expect(localStorage.getItem('divertiflix.session')).toContain('refresh'))
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/auth/login', body: { email: 'camille@test.com', password: 'Passw0rd!' } })
  })

  it.each([
    [401, 'Identifiants invalides.'],
    [429, /Trop de tentatives/],
    [500, /./],
  ])('affiche un message lisible sur %s', async (status, message) => {
    const user = userEvent.setup()
    mockApi({ 'POST /api/auth/login': { status, body: { title: 'x' } } })
    renderApp(<LoginPage />)
    await user.type(screen.getByLabelText('Courriel ou identifiant'), 'a')
    await user.type(screen.getByLabelText('Mot de passe'), 'b')
    await user.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeEnabled()
  })

  it('bascule vers la création de compte avec le nom du profil', async () => {
    const user = userEvent.setup()
    renderApp(<LoginPage />)
    await user.click(screen.getByRole('tab', { name: /Créer|Inscription/ }))
    expect(screen.getByLabelText('Nom du premier profil')).toBeRequired()
    expect(screen.getByRole('button', { name: 'Créer mon compte' })).toBeInTheDocument()
  })

  it('le mot de passe est masqué puis révélable', async () => {
    const user = userEvent.setup()
    renderApp(<LoginPage />)
    const pw = screen.getByLabelText('Mot de passe')
    expect(pw).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: /Afficher/ }))
    expect(pw).toHaveAttribute('type', 'text')
  })

  it('bascule la langue de l\'interface', async () => {
    const user = userEvent.setup()
    renderApp(<LoginPage />)
    await user.click(screen.getByRole('button', { name: 'English' }))
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
  })

  it('un seul titre de niveau 1 nomme la page, et suit le mode', async () => {
    const user = userEvent.setup()
    renderApp(<LoginPage />)
    expect(screen.getAllByRole('heading', { level: 1 }).map(h => h.textContent)).toEqual(['Connexion'])

    await user.click(screen.getByRole('tab', { name: 'Inscription' }))
    expect(screen.getAllByRole('heading', { level: 1 }).map(h => h.textContent)).toEqual(['Inscription'])
  })

  it('les onglets suivent le motif ARIA : un seul dans l\'ordre de tabulation, relié à son panneau, flèches pour changer', async () => {
    const user = userEvent.setup()
    renderApp(<LoginPage />)
    const login = screen.getByRole('tab', { name: 'Connexion' })
    const register = screen.getByRole('tab', { name: 'Inscription' })
    expect(login).toHaveAttribute('tabindex', '0')
    expect(register).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', login.id)
    expect(login).toHaveAttribute('aria-controls', screen.getByRole('tabpanel').id)

    login.focus()
    await user.keyboard('{ArrowRight}')
    expect(register).toHaveAttribute('aria-selected', 'true')
    expect(register).toHaveFocus()
    expect(register).toHaveAttribute('tabindex', '0')
    expect(login).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', register.id)
    expect(screen.getByLabelText('Nom du premier profil')).toBeInTheDocument()

    await user.keyboard('{ArrowLeft}')
    expect(login).toHaveAttribute('aria-selected', 'true')
    expect(login).toHaveFocus()
    await user.keyboard('{End}')
    expect(register).toHaveFocus()
    await user.keyboard('{Home}')
    expect(login).toHaveFocus()
  })

  it('Tab passe de l\'onglet actif directement au premier champ du formulaire', async () => {
    const user = userEvent.setup()
    renderApp(<LoginPage />)
    screen.getByRole('tab', { name: 'Connexion' }).focus()
    await user.tab()
    expect(screen.getByLabelText('Courriel ou identifiant')).toHaveFocus()
  })
})
