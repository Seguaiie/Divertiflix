import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeCard, mockApi, PROFILE_ID, renderApp, signIn } from '../test/utils'
import { PosterCard } from './PosterCard'

beforeEach(() => signIn())

describe('PosterCard', () => {
  it('relie la carte à sa fiche et décrit le titre aux lecteurs d\'écran', () => {
    mockApi({})
    const card = makeCard({ match: 88 })
    renderApp(<PosterCard card={card} />)
    const link = screen.getByRole('link', { name: /Lueur Boréale\. 2021, Thriller, 1 h 48/ })
    expect(link).toHaveAttribute('href', `/titres/${card.title.id}`)
    expect(screen.getByText('88 %')).toBeInTheDocument()
  })

  it('masque l\'indice d\'affinité sous 60 %', () => {
    mockApi({})
    renderApp(<PosterCard card={makeCard({ match: 59 })} />)
    expect(screen.queryByText('59 %')).not.toBeInTheDocument()
  })

  it('signale un titre non disponible et propose la fiche plutôt que la lecture', () => {
    mockApi({})
    renderApp(<PosterCard card={makeCard({}, { isPlayable: false, streamKind: null })} />)
    expect(screen.getByText('Sur demande')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Lecture de/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Voir la fiche de Lueur Boréale' })).toBeInTheDocument()
  })

  it('affiche la progression réelle de lecture', () => {
    mockApi({})
    const progress = { positionSeconds: 1620, durationSeconds: 6480, fraction: 0.25, updatedAt: '2026-01-02T00:00:00Z' }
    renderApp(<PosterCard card={makeCard({ progress })} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
  })

  it('explique la recommandation avec la raison réelle quand la rangée la demande', () => {
    mockApi({})
    const reason = { type: 'similarTo', titleId: null, title: 'Dune', genre: null, tags: null }
    const { rerender: _ } = renderApp(<PosterCard card={makeCard({ reason })} showReason />)
    expect(screen.getByText(/Dune/)).toBeInTheDocument()
  })

  it('ajoute à la liste puis annule si le serveur refuse', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi({ [`PUT /api/profiles/${PROFILE_ID}/watchlist/11111111-1111-4111-8111-111111111111`]: { status: 500 } })
    renderApp(<PosterCard card={makeCard()} />)
    const add = screen.getByRole('button', { name: 'Ajouter Lueur Boréale à ma liste' })
    expect(add).toHaveAttribute('aria-pressed', 'false')
    await user.click(add)
    await screen.findByRole('button', { name: 'Ajouter Lueur Boréale à ma liste' })
    expect(calls.some(c => c.method === 'PUT' && c.path.includes('/watchlist/'))).toBe(true)
  })

  it('ne propose pas les pouces quand la rangée les exclut', () => {
    mockApi({})
    renderApp(<PosterCard card={makeCard()} rated={false} />)
    expect(screen.queryByRole('button', { name: /J'aime/ })).not.toBeInTheDocument()
  })
})
