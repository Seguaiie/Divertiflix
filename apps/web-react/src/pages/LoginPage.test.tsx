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
})
