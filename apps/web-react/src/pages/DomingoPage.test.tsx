import { screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi, renderApp, signIn } from '../test/utils'
import { DomingoPage } from './DomingoPage'

const team = (id: number, name: string, abbreviation: string, score: number | null, isWinner: boolean) =>
  ({ id, name, abbreviation, score, isWinner, record: '97-65', logoUrl: `https://www.mlbstatic.com/team-logos/${id}.svg` })

const results = {
  updatedAt: '2026-11-03T20:00:00Z',
  days: [
    { date: '2026-10-28', games: [{
      id: 3, status: 'Live', detailedState: 'In Progress', gameType: 'W', seriesDescription: 'World Series', seriesGameNumber: 4,
      startTime: '2026-10-29T00:08:00Z', venue: 'Tropicana Field', inning: 7, inningHalf: 'Bottom',
      away: team(158, 'Milwaukee Brewers', 'MIL', 4, false), home: team(139, 'Tampa Bay Rays', 'TB', 1, false),
    }] },
    { date: '2026-10-27', games: [{
      id: 2, status: 'Final', detailedState: 'Final', gameType: 'W', seriesDescription: 'World Series', seriesGameNumber: 3,
      startTime: '2026-10-28T00:08:00Z', venue: 'Tropicana Field', inning: 11, inningHalf: 'Bottom',
      away: team(158, 'Milwaukee Brewers', 'MIL', 3, false), home: team(139, 'Tampa Bay Rays', 'TB', 4, true),
    }] },
  ],
}

const open = () => renderApp(<Routes><Route path="/domingo" element={<DomingoPage />} /></Routes>, { route: '/domingo' })

beforeEach(() => signIn())

describe('onglet Domingo (résultats MLB)', () => {
  it('affiche les journées de la plus récente à la plus ancienne, avec scores, gagnant et série', async () => {
    mockApi({ '/api/mlb/results': results })
    open()

    expect(await screen.findByRole('heading', { level: 1, name: 'Domingo' })).toBeInTheDocument()
    const days = await screen.findAllByRole('heading', { level: 2 })
    expect(days.map(d => d.textContent)).toEqual([expect.stringMatching(/28 octobre 2026/), expect.stringMatching(/27 octobre 2026/)])

    // Match terminé en manches supplémentaires : le gagnant ressort.
    const games = screen.getAllByRole('article', { name: 'Milwaukee Brewers à Tampa Bay Rays' })
    expect(games).toHaveLength(2)
    const g3 = games[1]!
    expect(within(g3).getByText('Final (11 manches)')).toBeInTheDocument()
    expect(within(g3).getByText('World Series · Match 3')).toBeInTheDocument()
    expect(g3.querySelector('.is-winner')?.textContent).toContain('Tampa Bay Rays')

    // Match en cours : la manche est indiquée, et personne n'est encore gagnant.
    const live = games[0]!
    expect(within(live).getByText('En direct · Fin 7e')).toBeInTheDocument()
    expect(live.querySelector('.is-winner')).toBeNull()
  })

  it('explique quand la MLB ne répond pas, avec un bouton pour réessayer', async () => {
    mockApi({ '/api/mlb/results': { status: 502, body: { title: 'Bad Gateway', status: 502, detail: 'Indisponible' } } })
    open()
    expect(await screen.findByText('Résultats indisponibles')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })
})
