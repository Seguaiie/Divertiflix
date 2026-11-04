import { screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi, renderApp, signIn } from '../test/utils'
import { DomingoPage } from './DomingoPage'

const team = (id: number, name: string, abbreviation: string, score: number | null, isWinner: boolean) =>
  ({ id, name, abbreviation, score, isWinner, record: '97-65', logoUrl: `/api/media/mlb/logo/${id}`, hits: 8, errors: 1 })

const results = {
  updatedAt: '2026-11-03T20:00:00Z',
  days: [
    { date: '2026-10-28', games: [{
      id: 3, status: 'Live', detailedState: 'In Progress', gameType: 'W', seriesDescription: 'World Series', seriesGameNumber: 4,
      startTime: '2026-10-29T00:08:00Z', venue: 'Tropicana Field', inning: 7, inningHalf: 'Bottom',
      away: team(158, 'Milwaukee Brewers', 'MIL', 4, false), home: team(139, 'Tampa Bay Rays', 'TB', 1, false),
      innings: [{ number: 1, awayRuns: 0, homeRuns: 1 }, { number: 2, awayRuns: 3, homeRuns: 0 }, { number: 3, awayRuns: 1, homeRuns: null }],
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
    const headings = await screen.findAllByRole('heading', { level: 2 })
    expect(headings.map(d => d.textContent)).toEqual(['À la une', expect.stringMatching(/28 octobre 2026.*1 match/), expect.stringMatching(/27 octobre 2026/)])

    // À la une : le dernier match, avec sa feuille de match manche par manche (au moins 9 colonnes) et P / CS / E.
    const board = screen.getByRole('table', { name: 'Feuille de match : Milwaukee Brewers à Tampa Bay Rays' })
    const [head, away, home] = within(board).getAllByRole('row')
    expect(within(head!).getAllByRole('columnheader').map(c => c.textContent)).toEqual(['Équipe', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'P', 'CS', 'E'])
    expect(within(away!).getAllByRole('cell').map(c => c.textContent)).toEqual(['0', '3', '1', '', '', '', '', '', '', '4', '8', '1'])
    expect(within(home!).getAllByRole('cell').slice(0, 3).map(c => c.textContent)).toEqual(['1', '0', 'X'])   // manche non jouée

    // Match terminé en manches supplémentaires : le gagnant ressort.
    const games = screen.getAllByRole('article', { name: 'Milwaukee Brewers à Tampa Bay Rays' })
    expect(games).toHaveLength(2)
    const g3 = games[1]!
    expect(within(g3).getByText('Final (11 manches)')).toBeInTheDocument()
    expect(within(g3).getByText('World Series · Match 3')).toBeInTheDocument()
    expect(g3.querySelector('.is-winner')?.textContent).toContain('Tampa Bay Rays')
    expect(within(g3).getByTitle('Victoire')).toHaveTextContent('V')   // badge du gagnant
    // Couleurs des équipes passées à la carte (Brewers en or, Rays en bleu pâle).
    expect(g3.style.getPropertyValue('--away')).toBe('#ffc52f')
    expect(g3.style.getPropertyValue('--home')).toBe('#8fbce6')

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
