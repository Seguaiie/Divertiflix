import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi, renderApp, signIn } from '../test/utils'
import { AiLeaderboard } from './AiLeaderboard'

const model = (name: string, organization: string, score: number) => ({ name, effort: null, organization, date: '2026-09-22', score, low: score - 3, high: score + 4 })
const entry = (name: string, organization: string, score: number, effort: string | null = 'max') => ({ name, effort, organization, date: '2026-09-22', score })

const data = {
  leaderboard: [
    model('GPT-6 Astra', 'OpenAI', 169.1), model('Claude Opus 5.5', 'Anthropic', 168.4), model('GPT-6.1 Terra', 'OpenAI', 168.1),
    model('GPT-6.1 Sol', 'OpenAI', 167.8), model('Gemini 4 Argon', 'Google DeepMind', 166.1),
  ],
  latest: [{ name: 'GPT-6.1 Terra', organization: 'OpenAI', date: '2026-10-26', score: 168.1 }],
  benchmarks: [
    { id: 'gpqa', name: 'GPQA Diamond', top: [entry('Gemini 4 Argon', 'Google DeepMind', 96.4, 'high'), entry('GPT-6 Astra', 'OpenAI', 95.8)] },
    { id: 'swe', name: 'SWE-bench Verified', top: [entry('Claude Opus 4.7', 'Anthropic', 83.5)] },
  ],
  source: 'Epoch AI', sourceUrl: 'https://epoch.ai/benchmarks', license: 'CC BY 4.0', updatedAt: '2026-11-04T15:00:00Z',
}

beforeEach(() => signIn())

describe('classement des modèles d\'IA', () => {
  it('podium, classement, derniers arrivés et crédit de la source', async () => {
    mockApi({ '/api/news/ai/benchmarks': data })
    renderApp(<AiLeaderboard />)

    expect(await screen.findByRole('heading', { name: 'Le classement des modèles' })).toBeInTheDocument()
    const [podium, rest] = screen.getAllByRole('list').filter(l => l.tagName === 'OL')
    const steps = within(podium!).getAllByRole('listitem')
    expect(steps.map(s => s.querySelector('.ai-podium-name')?.textContent)).toEqual(['GPT-6 Astra', 'Claude Opus 5.5', 'GPT-6.1 Terra'])
    expect(steps[0]).toHaveClass('p1')
    expect(within(steps[0]!).getByTitle('Intervalle de confiance : 166.1 à 173.1')).toHaveTextContent('169.1')
    // Rangs 4 et suivants en barres, couleur du laboratoire.
    expect(within(rest!).getAllByRole('listitem').map(l => l.querySelector('.ai-bar-name')?.textContent)).toEqual(['GPT-6.1 Sol', 'Gemini 4 Argon'])
    expect(within(rest!).getAllByRole('listitem')[1]!.style.getPropertyValue('--org')).toBe('#5b9bff')

    expect(screen.getByText('Derniers arrivés')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Données : Epoch AI \(CC BY 4\.0\)/ })).toHaveAttribute('href', 'https://epoch.ai/benchmarks')
  })

  it('change de banc d\'essai au clic et aux flèches du clavier', async () => {
    mockApi({ '/api/news/ai/benchmarks': data })
    renderApp(<AiLeaderboard />)

    const gpqa = await screen.findByRole('tab', { name: /GPQA Diamond/ })
    expect(gpqa).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('tabpanel')).getByText('96.4 %')).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).getByText('high')).toBeInTheDocument()   // niveau d'effort évalué

    await userEvent.click(screen.getByRole('tab', { name: /SWE-bench/ }))
    expect(within(screen.getByRole('tabpanel')).getByText('Claude Opus 4.7')).toBeInTheDocument()

    await userEvent.keyboard('{ArrowRight}')   // dernier onglet → retour au premier
    expect(screen.getByRole('tab', { name: /GPQA Diamond/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /GPQA Diamond/ })).toHaveFocus()
  })

  it('reste discret si le classement est indisponible', async () => {
    mockApi({ '/api/news/ai/benchmarks': { status: 502, body: { title: 'Bad Gateway', status: 502 } } })
    renderApp(<AiLeaderboard />)
    expect(await screen.findByText('Le classement est indisponible pour le moment.')).toBeInTheDocument()
  })
})
