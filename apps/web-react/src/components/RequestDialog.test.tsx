import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en'
import { fr } from '../i18n/fr'
import { mockApi, renderApp, signIn } from '../test/utils'
import { useUI } from '../state/ui'
import { RequestDialog } from './RequestDialog'

const Open = () => { const ui = useUI(); useEffect(() => ui.openRequest('Nosferatu'), []); return null } // eslint-disable-line react-hooks/exhaustive-deps

beforeEach(() => signIn())

async function submit(locale: 'fr' | 'en') {
  renderApp(<><Open /><RequestDialog /></>, { locale })
  await userEvent.setup().click(await screen.findByRole('button', { name: locale === 'fr' ? fr['request.submit'] : en['request.submit'] }))
  return await screen.findByRole('alert')
}

describe('RequestDialog : messages d\'erreur', () => {
  it('une demande en double s\'affiche dans la langue de l\'interface, jamais avec le texte français du serveur', async () => {
    mockApi({ 'POST /api/requests': { status: 409, body: { error: 'Ce titre a déjà été demandé.' } } })
    const alert = await submit('en')
    expect(alert).toHaveTextContent(en['request.conflict'])
    expect(alert).not.toHaveTextContent('déjà')
  })

  it('un refus du limiteur sans corps donne un message de limite, pas « Erreur inattendue »', async () => {
    mockApi({ 'POST /api/requests': { status: 429 } })
    expect(await submit('en')).toHaveTextContent(en['error.rateLimited'])
  })

  it('un serveur injoignable donne un message traduit, jamais le mot « network »', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const alert = await submit('fr')
    expect(alert).toHaveTextContent(fr['error.network'])
    expect(alert).not.toHaveTextContent(/network/i)
  })

  it('une panne du serveur donne un message de service indisponible', async () => {
    mockApi({ 'POST /api/requests': { status: 502 } })
    expect(await submit('fr')).toHaveTextContent(fr['error.server'])
  })
})
