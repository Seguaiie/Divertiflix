import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { S } from '../lib/api'
import { makeCard, makeTitle, mockApi, PROFILE_ID, renderApp, signIn } from '../test/utils'
import { Player } from './Player'

const title = makeTitle({ streamKind: 'Video' })
const playback = { titleId: title.id, url: 'https://media.test/film.mp4', kind: 'Video', startSeconds: 0, expiresAt: '2030-01-01T00:00:00Z' } as S['PlaybackDto']
const next = makeCard({}, { id: '22222222-2222-4222-8222-222222222222', name: 'Brume d\'automne' })

beforeEach(() => {
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
