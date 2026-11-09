import { screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi, renderApp, signIn } from '../test/utils'
import { ServicesPage } from './ServicesPage'

const probe = (key: string, name: string, state: string, extra: Record<string, unknown> = {}) => ({
  key, name, url: `https://${key}.home.arpa/`, portal: true, state, latencyMs: 230, httpCode: null, tls: 'untrusted',
  certNotAfter: null, certIssuer: null, error: null, checkedAt: '2026-11-09T16:20:00Z', since: '2026-11-09T15:00:00Z', ...extra,
})

const open = () => renderApp(<Routes><Route path="/services" element={<ServicesPage />} /></Routes>, { route: '/services' })

beforeEach(() => signIn())

describe('onglet Services', () => {
  it('une tuile par application avec son état mesuré, un résumé honnête et des liens sûrs', async () => {
    mockApi({
      '/api/services': [
        probe('jellyfin', 'Jellyfin', 'up'),
        probe('bookstack', 'BookStack', 'degraded', { error: 'Erreur 500 du service' }),
        probe('homarr', 'Homarr', 'down', { error: 'Route absente dans Traefik (certificat par défaut)', tls: 'traefik-default', latencyMs: null }),
      ],
    })
    open()

    expect(await screen.findByText('2 service(s) perturbé(s) ou hors ligne')).toBeInTheDocument()
    const jellyfin = screen.getByRole('link', { name: /Ouvrir Jellyfin — En ligne/ })
    expect(jellyfin).toHaveAttribute('href', 'https://jellyfin.home.arpa/')
    expect(jellyfin).toHaveAttribute('target', '_blank')
    expect(jellyfin).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(jellyfin).getByText('Films et séries en streaming')).toBeInTheDocument()
    expect(within(jellyfin).getByText('· 230 ms')).toBeInTheDocument()

    const homarr = screen.getByRole('link', { name: /Ouvrir Homarr — Hors ligne/ })
    expect(homarr).toHaveClass('is-down')
    expect(within(homarr).getByText('Route absente dans Traefik (certificat par défaut)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ouvrir BookStack — Perturbé/ })).toHaveClass('is-degraded')

    // Autorité interne pas encore reconnue : on prévient de l'avertissement du navigateur.
    expect(screen.getByText(/certificat de l'autorité « divertiflixCA »/)).toBeInTheDocument()
  })

  it('tout va bien : le résumé le dit, sans note de certificat quand tout est vérifié', async () => {
    mockApi({ '/api/services': [probe('ntfy', 'ntfy', 'up', { tls: 'verified' })] })
    open()
    expect(await screen.findByText('Tout fonctionne')).toBeInTheDocument()
    expect(screen.queryByText(/divertiflixCA/)).toBeNull()
  })
})
