import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi, renderApp, signIn } from '../test/utils'
import { DivertissementPage } from './DivertissementPage'

const item = (id: string, title: string, source: string) =>
  ({ id, title, summary: null, url: `https://example.test/${id}`, source, feed: source, language: 'fr', publishedAt: '2026-11-16T12:00:00Z', imageUrl: null, coverage: 1 })

const emilien = {
  sections: [
    { key: 'osrs', label: 'Old School RuneScape', items: [item('1', 'Mise à jour OSRS', 'r/2007scape')], sources: [{ name: 'r/2007scape', language: 'en', count: 1, ok: true }] },
    { key: 'lol', label: 'Scène LoL esport', items: [item('2', 'Finale des Worlds', 'Esports Insider')], sources: [{ name: 'Esports Insider', language: 'en', count: 1, ok: true }] },
    { key: 'fantasy', label: 'Fantasy', items: [], sources: [{ name: 'Reactor', language: 'en', count: 0, ok: true }] },
  ],
  updatedAt: '2026-11-16T12:00:00Z',
}
const alexi = { sections: [{ key: 'idle', label: 'Idle games', items: [item('3', 'Nouveau idle game', 'r/incremental_games')], sources: [] }], updatedAt: '2026-11-16T12:00:00Z' }

const open = (route = '/divertissement/emilien') =>
  renderApp(<Routes><Route path="/divertissement/:person" element={<DivertissementPage />} /></Routes>, { route })

beforeEach(() => signIn())

describe('onglet Divertissement (centres d\'intérêt de l\'équipe)', () => {
  it('montre les rubriques du membre choisi, avec une rubrique vide signalée comme telle', async () => {
    mockApi({ '/api/news/divertissement/Emilien': emilien })
    open()

    expect(await screen.findByRole('heading', { level: 1, name: 'Divertissement' })).toBeInTheDocument()
    expect(await screen.findByText('Mise à jour OSRS')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Old School RuneScape' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Scène LoL esport' })).toBeInTheDocument()
    expect(screen.getByText('Finale des Worlds')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Fantasy (littérature)' })).toBeInTheDocument()
    expect(screen.getByText('Rien de neuf pour le moment.')).toBeInTheDocument()
  })

  it('change de membre via les onglets, qui vont chacun chercher leurs propres nouvelles', async () => {
    const user = userEvent.setup()
    mockApi({ '/api/news/divertissement/Emilien': emilien, '/api/news/divertissement/Alexi': alexi })
    open()
    await screen.findByText('Mise à jour OSRS')

    const nav = screen.getByRole('navigation', { name: 'Choisir un membre de l\'équipe' })
    await user.click(within(nav).getByRole('link', { name: 'Alexi' }))

    expect(await screen.findByText('Nouveau idle game')).toBeInTheDocument()
    expect(screen.queryByText('Mise à jour OSRS')).not.toBeInTheDocument()
  })

  it('un membre inconnu dans l\'adresse redirige vers le premier', async () => {
    mockApi({ '/api/news/divertissement/Emilien': emilien })
    open('/divertissement/quelquun-dinconnu')
    expect(await screen.findByText('Mise à jour OSRS')).toBeInTheDocument()
  })

  it('explique quand les sources ne répondent pas, avec un bouton pour réessayer', async () => {
    mockApi({ '/api/news/divertissement/Emilien': { status: 502, body: { title: 'Bad Gateway', status: 502, detail: 'Indisponible' } } })
    open()
    expect(await screen.findByText('Nouvelles indisponibles')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })
})
