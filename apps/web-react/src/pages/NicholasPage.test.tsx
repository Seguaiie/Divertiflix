import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi, renderApp, signIn } from '../test/utils'
import { NicholasPage } from './NicholasPage'

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const item = (id: string, title: string, source: string, language: 'fr' | 'en', minutes: number, imageUrl: string | null = null, summary: string | null = 'Résumé.') =>
  ({ id, title, summary, url: `https://example.com/${id}`, source, feed: source, language, publishedAt: minutesAgo(minutes), imageUrl })

const news = {
  windowHours: 24,
  updatedAt: minutesAgo(1),
  items: [
    item('a', "L'IA au Québec", 'Le Devoir', 'fr', 20),
    item('b', 'OpenAI ships a new model', 'TechCrunch', 'en', 45, '/api/media/news/image/0123456789abcdef01234567'),
    item('c', 'Robots fold laundry', 'The Verge', 'en', 300),
    item('d', 'Une IA française', 'Journal du Geek', 'fr', 600, null, null),
  ],
  sources: [
    { name: 'TechCrunch', language: 'en', count: 1, ok: true },
    { name: 'Wired', language: 'en', count: 0, ok: false },
  ],
}

const open = () => renderApp(<Routes><Route path="/nicholas" element={<NicholasPage />} /></Routes>, { route: '/nicholas' })

beforeEach(() => signIn())

describe('onglet Nicholas (nouvelles de l\'IA)', () => {
  it('met à la une le plus récent avec image, puis le fil ; liens externes sûrs et illustration sans image', async () => {
    mockApi({ '/api/news/ai': news })
    open()

    expect(await screen.findByRole('heading', { level: 1, name: 'Nicholas' })).toBeInTheDocument()
    const top = await screen.findByRole('region', { name: 'À la une' })
    expect(within(top).getByText('OpenAI ships a new model')).toBeInTheDocument()   // le plus récent qui a une image
    expect(within(top).getByText('Nouveau')).toBeInTheDocument()                    // moins de 2 h

    const feed = screen.getByRole('region', { name: 'Fil des nouvelles' })
    const links = within(feed).getAllByRole('link')
    expect(links.map(l => l.textContent)).toEqual([
      expect.stringContaining("L'IA au Québec"), expect.stringContaining('Robots fold laundry'), expect.stringContaining('Une IA française'),
    ])
    // Article externe : nouvel onglet, sans transmettre l'adresse du portail ni donner la main à la page ouverte.
    expect(links[0]).toHaveAttribute('target', '_blank')
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer')
    expect(links[0]).toHaveAttribute('href', 'https://example.com/a')
    // Sans image : illustration aux initiales de la source.
    expect(within(links[2]!).getByText('JD')).toBeInTheDocument()

    // Source en panne signalée.
    expect(screen.getByText('Wired ne répond pas')).toBeInTheDocument()
  })

  it('filtre par langue puis par source', async () => {
    mockApi({ '/api/news/ai': news })
    open()
    await screen.findByRole('region', { name: 'À la une' })

    await userEvent.click(screen.getByRole('button', { name: /Français/ }))
    expect(screen.getByRole('button', { name: /Français/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('OpenAI ships a new model')).toBeNull()
    expect(screen.getByText("L'IA au Québec")).toBeInTheDocument()   // à la une à défaut d'image : le plus récent
    expect(screen.getByText('2 articles', { exact: false })).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Source' }), 'Journal du Geek')
    expect(screen.queryByText("L'IA au Québec")).toBeNull()
    expect(screen.getByText('Une IA française')).toBeInTheDocument()
  })

  it('explique quand aucune source ne répond', async () => {
    mockApi({ '/api/news/ai': { status: 502, body: { title: 'Bad Gateway', status: 502 } } })
    open()
    expect(await screen.findByText('Nouvelles indisponibles')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })
})
