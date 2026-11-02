import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeCard, mockApi, renderApp, signIn } from '../test/utils'
import { ListenPage } from './ListenPage'

const hlsMock = vi.hoisted(() => ({ loadSource: vi.fn(), attachMedia: vi.fn(), destroy: vi.fn(), on: vi.fn(), options: undefined as unknown }))
vi.mock('hls.js', () => ({
  default: class {
    static isSupported() { return true }
    static Events = { ERROR: 'hlsError' }
    constructor(options?: unknown) { hlsMock.options = options }
    loadSource = hlsMock.loadSource
    attachMedia = hlsMock.attachMedia
    destroy = hlsMock.destroy
    on = hlsMock.on
  },
}))

const book = makeCard({}, { kind: 'Audiobook', streamKind: 'Audio', externalSource: 'Audiobookshelf', name: 'Oathbringer', author: 'Brandon Sanderson', narrator: 'Johann Dettweiler', durationMinutes: 120 })
const ID = book.title.id
const URL = '/api/media/abs/hls/jeton/session1/output.m3u8'
const playback = {
  titleId: ID, url: URL, kind: 'Hls', startSeconds: 1800, expiresAt: '2030-01-01T00:00:00Z',
  chapters: [{ title: 'Prologue', startSeconds: 0, endSeconds: 3600 }, { title: 'Chapitre un', startSeconds: 3600, endSeconds: 7200 }],
}
const listen = () => renderApp(<Routes><Route path="/ecouter/:id" element={<ListenPage />} /></Routes>, { route: `/ecouter/${ID}` })

beforeEach(() => {
  signIn()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})

describe('page d\'écoute d\'un livre audio', () => {
  it('charge le livre dans le lecteur du site : flux HLS continu, reprise à la position du profil', async () => {
    mockApi({ [`/api/titles/${ID}/detail`]: { card: book, similar: [], request: null }, [`/api/titles/${ID}/playback`]: playback })
    listen()
    expect(await screen.findByRole('heading', { name: 'Oathbringer' })).toBeInTheDocument()
    await waitFor(() => expect(hlsMock.loadSource).toHaveBeenCalledWith(URL))
    expect(hlsMock.attachMedia).toHaveBeenCalledWith(expect.any(HTMLAudioElement))
    expect(hlsMock.options).toMatchObject({ startPosition: 1800 })
    expect(screen.getByText(/Brandon Sanderson/)).toBeInTheDocument()
  })

  it('liste les chapitres et saute au chapitre choisi', async () => {
    mockApi({ [`/api/titles/${ID}/detail`]: { card: book, similar: [], request: null }, [`/api/titles/${ID}/playback`]: playback })
    listen()
    const second = await screen.findByRole('button', { name: /Chapitre un/ })
    await userEvent.setup().click(second)
    const audio = document.querySelector('audio')!
    expect(audio.currentTime).toBe(3600)
  })

  it('un titre sans lecture possible affiche « Pas encore disponible »', async () => {
    const none = makeCard({}, { streamKind: null, isPlayable: false })
    mockApi({ [`/api/titles/${none.title.id}/detail`]: { card: none, similar: [], request: null } })
    renderApp(<Routes><Route path="/ecouter/:id" element={<ListenPage />} /></Routes>, { route: `/ecouter/${none.title.id}` })
    expect(await screen.findByText('Pas encore disponible')).toBeInTheDocument()
  })
})
