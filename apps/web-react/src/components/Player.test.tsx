import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { S } from '../lib/api'
import { makeCard, makeTitle, mockApi, PROFILE_ID, renderApp, signIn } from '../test/utils'
import { Player } from './Player'

// hls.js simulé : les tests n'ont besoin que de ses évènements d'erreur et de ce que le lecteur lui demande en retour.
const hls = vi.hoisted(() => {
  const state = { supported: true, handlers: {} as Record<string, (event: string, data: unknown) => void>, startLoad: 0, recover: 0, loadSource: [] as string[] }
  class FakeHls {
    static isSupported = () => state.supported
    static Events = { MANIFEST_PARSED: 'manifestParsed', SUBTITLE_TRACKS_UPDATED: 'subtitleTracks', AUDIO_TRACKS_UPDATED: 'audioTracks', ERROR: 'hlsError' }
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' }
    static ErrorDetails = {
      MANIFEST_LOAD_ERROR: 'manifestLoadError', MANIFEST_LOAD_TIMEOUT: 'manifestLoadTimeOut', MANIFEST_PARSING_ERROR: 'manifestParsingError',
      LEVEL_EMPTY_ERROR: 'levelEmptyError', LEVEL_LOAD_ERROR: 'levelLoadError', LEVEL_LOAD_TIMEOUT: 'levelLoadTimeOut', LEVEL_PARSING_ERROR: 'levelParsingError',
      FRAG_LOAD_ERROR: 'fragLoadError',
    }
    on(event: string, cb: (event: string, data: unknown) => void) { state.handlers[event] = cb }
    loadSource(url: string) { state.loadSource.push(url) }
    attachMedia() {}
    startLoad() { state.startLoad++ }
    recoverMediaError() { state.recover++ }
    destroy() {}
  }
  return { state, FakeHls }
})
vi.mock('hls.js', () => ({ default: hls.FakeHls }))

const title = makeTitle({ streamKind: 'Video' })
const playback = { titleId: title.id, url: 'https://media.test/film.mp4', kind: 'Video', startSeconds: 0, expiresAt: '2030-01-01T00:00:00Z' } as S['PlaybackDto']
const next = makeCard({}, { id: '22222222-2222-4222-8222-222222222222', name: 'Brume d\'automne' })

beforeEach(() => {
  Object.assign(hls.state, { supported: true, handlers: {}, startLoad: 0, recover: 0, loadSource: [] })
  signIn()
  // jsdom ne lit pas les médias : on neutralise ce qu'il n'implémente pas.
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

function watch(over: { onBack?(): void; onRetry?(): void } = {}) {
  mockApi({ [`PUT /api/profiles/${PROFILE_ID}/progress/${title.id}`]: { status: 204 } })
  renderApp(<Player profileId={PROFILE_ID} title={title} playback={playback} similar={[next]} onBack={over.onBack ?? (() => {})} onRetry={over.onRetry ?? (() => {})} />)
  return screen.getByLabelText(title.name, { selector: 'video' }) as HTMLVideoElement
}
const controls = () => [document.querySelector('.pl-top'), document.querySelector('.pl-bottom')]

describe('Player : fin du film', () => {
  it('la boîte de fin est modale, prend le focus sur « Revoir » et sort les commandes masquées de l\'ordre de tabulation', () => {
    const video = watch()
    expect(controls().every(c => !c?.hasAttribute('inert'))).toBe(true)

    fireEvent.ended(video)

    const dialog = screen.getByRole('dialog', { name: 'Fin de la lecture' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Revoir' })).toHaveFocus()
    expect(controls().every(c => c?.hasAttribute('inert'))).toBe(true) // la barre d'en-tête et les commandes sont sous la boîte
  })

  it('Tab reste sur les boutons de la boîte de fin, jamais sur les commandes cachées dessous', async () => {
    const user = userEvent.setup()
    fireEvent.ended(watch())

    const reachable: string[] = []
    for (let i = 0; i < 4; i++) { reachable.push(document.activeElement?.textContent ?? ''); await user.tab() }
    expect(reachable.every(text => /Revoir|Retour au catalogue|Brume d'automne/.test(text))).toBe(true)
  })

  it('« Revoir » ferme la boîte et rend le focus aux commandes, pas à <body>', async () => {
    const user = userEvent.setup()
    fireEvent.ended(watch())

    await user.click(screen.getByRole('button', { name: 'Revoir' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(controls().every(c => !c?.hasAttribute('inert'))).toBe(true)
    expect(document.querySelector('.pl-bar .icon-btn')).toHaveFocus()
  })
})

describe('Player : erreur de lecture', () => {
  it('l\'erreur est une boîte d\'alerte modale qui prend le focus sur « Réessayer »', async () => {
    const onRetry = vi.fn()
    const user = userEvent.setup()
    fireEvent.error(watch({ onRetry }))

    const dialog = screen.getByRole('alertdialog', { name: 'La lecture a échoué' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Réessayer' })).toHaveFocus()
    expect(controls().every(c => c?.hasAttribute('inert'))).toBe(true)

    await user.keyboard('{Enter}')
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('Player : lecture HLS en échec', () => {
  const hlsPlayback = { ...playback, url: '/api/media/stream/jeton/film/index.m3u8', kind: 'Hls' } as S['PlaybackDto']
  function watchHls() {
    mockApi({})
    renderApp(<Player profileId={PROFILE_ID} title={makeTitle({ streamKind: 'Hls' })} playback={hlsPlayback} similar={[]} onBack={() => {}} onRetry={() => {}} />)
    return vi.waitFor(() => expect(hls.state.handlers['hlsError']).toBeTypeOf('function'))
  }
  const fail = (details: string, type = 'networkError') => act(() => hls.state.handlers['hlsError']!('hlsError', { fatal: true, type, details }))

  it.each(['manifestLoadError', 'manifestLoadTimeOut', 'manifestParsingError', 'levelLoadError', 'levelEmptyError'])(
    'une erreur fatale %s (404, 403 ou 5xx du manifeste) montre tout de suite la boîte d\'erreur avec « Réessayer », jamais un spinner infini',
    async details => {
      await watchHls()
      expect(screen.getByRole('status')).toBeInTheDocument() // le spinner de chargement, en attendant le manifeste

      await fail(details)

      expect(screen.getByRole('alertdialog', { name: 'La lecture a échoué' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Réessayer' })).toHaveFocus()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(hls.state.startLoad).toBe(0) // startLoad() ne relance pas le manifeste : inutile de s'y fier
    },
  )

  it('une erreur de segment est retentée deux fois avant d\'être déclarée', async () => {
    await watchHls()
    await fail('fragLoadError'); await fail('fragLoadError')
    expect(hls.state.startLoad).toBe(2)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await fail('fragLoadError')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('une erreur de média est reprise deux fois, puis déclarée', async () => {
    await watchHls()
    await fail('bufferAppendError', 'mediaError'); await fail('bufferAppendError', 'mediaError')
    expect(hls.state.recover).toBe(2)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await fail('bufferAppendError', 'mediaError')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('en lecture HLS native (Safari), une erreur de la balise vidéo montre aussi la boîte d\'erreur', async () => {
    hls.state.supported = false
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe')
    mockApi({})
    renderApp(<Player profileId={PROFILE_ID} title={makeTitle({ streamKind: 'Hls' })} playback={hlsPlayback} similar={[]} onBack={() => {}} onRetry={() => {}} />)
    const video = screen.getByLabelText('Lueur Boréale', { selector: 'video' }) as HTMLVideoElement
    await vi.waitFor(() => expect(video.getAttribute('src')).toBe(hlsPlayback.url))

    fireEvent.error(video)

    expect(screen.getByRole('alertdialog', { name: 'La lecture a échoué' })).toBeInTheDocument()
  })

  it('avec hls.js, une erreur de la balise vidéo ne double pas celles que hls.js traite lui-même', async () => {
    await watchHls()
    fireEvent.error(screen.getByLabelText('Lueur Boréale', { selector: 'video' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('Player : menu de vitesse au clavier', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    const video = watch()
    const trigger = screen.getByRole('button', { name: 'Vitesse de lecture' })
    await user.click(trigger)
    return { trigger, video }
  }

  it('les flèches, Début et Fin parcourent les entrées en boucle', async () => {
    const user = userEvent.setup()
    await open(user)

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: '0.5×' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitemradio', { name: '2×' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: '0.5×' })).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitemradio', { name: '2×' })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByRole('menuitemradio', { name: '0.5×' })).toHaveFocus()
  })

  it('Échap referme le menu et rend le focus à son bouton, sans quitter le lecteur', async () => {
    const onBack = vi.fn()
    const user = userEvent.setup()
    watch({ onBack })
    const trigger = screen.getByRole('button', { name: 'Vitesse de lecture' })
    await user.click(trigger)
    await user.keyboard('{ArrowDown}{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(onBack).not.toHaveBeenCalled()
  })

  it('choisir une vitesse au clavier applique le réglage et rend le focus au bouton', async () => {
    const user = userEvent.setup()
    const { trigger, video } = await open(user)

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}') // 0.5×, 0.75×, normale, 1.25×
    expect(video.playbackRate).toBe(1.25)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('menu fermé, les flèches gardent leur rôle de raccourci (volume) au lieu d\'ouvrir quoi que ce soit', async () => {
    const user = userEvent.setup()
    const video = watch()
    video.volume = 0.8
    screen.getByRole('button', { name: 'Vitesse de lecture' }).focus()
    await user.keyboard('{ArrowDown}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(video.volume).toBeCloseTo(0.75)
  })
})
