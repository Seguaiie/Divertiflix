import { QueryClient } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeCard, mockApi, PROFILE_ID, renderApp, signIn } from '../test/utils'
import { WatchPage } from './WatchPage'

const card = makeCard({}, { streamKind: 'Video' })
const ID = card.title.id
const watch = () => renderApp(<Routes><Route path="/regarder/:id" element={<WatchPage />} /></Routes>, { route: `/regarder/${ID}` })
const detail = { card, similar: [], request: null }
const online = () => act(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')) })
const settle = () => act(() => new Promise(r => setTimeout(r, 50)))

/** Réponse de lecture dont l'adresse change à chaque appel, comme une URL signée : tout nouvel appel se voit. */
function playbackRoute() {
  let n = 0
  return () => ({ titleId: ID, url: `https://media.test/film.mp4?sig=${++n}`, kind: 'Video', startSeconds: 0, expiresAt: '2030-01-01T00:00:00Z' })
}
const count = (calls: { path: string }[], suffix: string) => calls.filter(c => c.path.endsWith(suffix)).length

beforeEach(() => {
  signIn()
  // jsdom ne lit pas les médias : on neutralise ce qu'il n'implémente pas et on garde la trace des pauses.
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

describe('WatchPage : retour du réseau', () => {
  it('une coupure puis un retour du réseau ne relance pas la lecture ni ne remplace le lecteur', async () => {
    const { calls } = mockApi({ [`/api/titles/${ID}/detail`]: detail, [`/api/titles/${ID}/playback`]: playbackRoute() })
    watch()
    const video = await screen.findByLabelText(card.title.name, { selector: 'video' })

    online(); await settle()

    expect(count(calls, '/playback')).toBe(1)
    expect(screen.getByLabelText(card.title.name, { selector: 'video' })).toBe(video) // le même élément : la lecture n'a pas redémarré
  })

  it('un rafraîchissement de la fiche qui échoue ne remplace pas le lecteur par l\'écran d\'erreur', async () => {
    let n = 0
    const { calls } = mockApi({ [`/api/titles/${ID}/detail`]: () => (++n === 1 ? detail : { status: 503, body: {} }), [`/api/titles/${ID}/playback`]: playbackRoute() })
    watch()
    const video = await screen.findByLabelText(card.title.name, { selector: 'video' })

    online()
    await waitFor(() => expect(count(calls, '/detail')).toBe(2)) // la relecture a bien eu lieu, et échoué
    await settle()

    expect(screen.getByLabelText(card.title.name, { selector: 'video' })).toBe(video)
    expect(screen.queryByText('La lecture a échoué')).not.toBeInTheDocument()
  })

  it('sans aucune donnée, une erreur de lecture montre l\'écran d\'erreur', async () => {
    mockApi({ [`/api/titles/${ID}/detail`]: detail, [`/api/titles/${ID}/playback`]: { status: 503, body: {} } })
    watch()
    expect(await screen.findByText('La lecture a échoué')).toBeInTheDocument()
  })
})

describe('WatchPage : à l\'ouverture et à la sortie', () => {
  it('met en pause le livre audio du lecteur persistant', async () => {
    mockApi({ [`/api/titles/${ID}/detail`]: detail, [`/api/titles/${ID}/playback`]: playbackRoute() })
    const pause = vi.mocked(HTMLMediaElement.prototype.pause)
    watch()
    await screen.findByLabelText(card.title.name, { selector: 'video' })
    expect(pause.mock.contexts.some(el => el instanceof HTMLAudioElement)).toBe(true)
  })

  it('n\'invalide l\'accueil qu\'une fois la progression réellement enregistrée', async () => {
    let release!: () => void
    const put = new Promise<{ status: number }>(r => { release = () => r({ status: 204 }) })
    mockApi({
      [`/api/titles/${ID}/detail`]: detail, [`/api/titles/${ID}/playback`]: playbackRoute(),
      [`PUT /api/profiles/${PROFILE_ID}/progress/${ID}`]: () => put,
    })
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    const { unmount } = watch()
    const video = await screen.findByLabelText(card.title.name, { selector: 'video' })
    Object.defineProperty(video, 'currentTime', { value: 30, configurable: true })
    fireEvent.timeUpdate(video)

    unmount() // quitter la lecture envoie la progression
    await settle()
    const touchesHome = () => invalidate.mock.calls.some(([f]) => JSON.stringify((f as { queryKey?: unknown })?.queryKey) === JSON.stringify(['home', PROFILE_ID]))
    expect(touchesHome()).toBe(false) // le PUT est encore en vol : un GET de l'accueil lirait l'ancien état

    release()
    await waitFor(() => expect(touchesHome()).toBe(true))
  })
})
