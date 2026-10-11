import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from './App'
import { makeCard, mockApi, PROFILE_ID, renderApp, signIn } from './test/utils'

const card = makeCard({}, { streamKind: 'Video', name: 'Lueur Boréale' })
const ID = card.title.id

beforeEach(() => {
  signIn()
  // jsdom ne lit pas les médias : on neutralise ce qu'il n'implémente pas.
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

function routes() {
  return mockApi({
    '/api/profiles': [{ id: PROFILE_ID, name: 'Camille' }],
    '/api/home': { hero: [], rows: [] },
    [`/api/titles/${ID}/detail`]: { card, similar: [], request: null },
    [`/api/titles/${ID}/playback`]: { titleId: ID, url: 'https://media.test/film.mp4', kind: 'Video', startSeconds: 0, expiresAt: '2030-01-01T00:00:00Z' },
    [`PUT /api/profiles/${PROFILE_ID}/progress/${ID}`]: { status: 204 },
    'POST /api/assistant/chat': { reply: 'found', param: null, unknownTitle: null, understood: [], steps: [], cards: [card] },
  })
}
// L'accueil (et la coque du portail) est affiché : <main id="main"> n'existe ni sur la lecture ni sur la connexion.
const shell = () => waitFor(() => expect(document.querySelector('main#main')).toBeInTheDocument())
const noDialog = () => {
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(document.body.style.overflow).not.toBe('hidden') // le fond n'est pas verrouillé par un dialogue fantôme
}

describe('raccourcis globaux : seulement là où leurs dialogues existent', () => {
  it('Ctrl+K pressé sur la page de lecture ne rouvre pas la palette au retour à l\'accueil', async () => {
    const user = userEvent.setup()
    routes()
    renderApp(<AppRoutes />, { route: `/regarder/${ID}` })
    await screen.findByLabelText('Lueur Boréale', { selector: 'video' })

    await user.keyboard('{Control>}k{/Control}{Control>}j{/Control}/')
    await user.keyboard('{Escape}') // quitte la lecture : retour à l'accueil

    await shell()
    noDialog()
  })

  it('un raccourci pressé sur la page de connexion ne rouvre rien non plus après la connexion', async () => {
    const user = userEvent.setup()
    localStorage.clear()
    routes()
    renderApp(<AppRoutes />, { route: '/connexion' })
    await screen.findByRole('button', { name: 'Se connecter' })

    await user.keyboard('{Control>}k{/Control}')
    signIn()
    window.dispatchEvent(new StorageEvent('storage', { key: 'divertiflix.session' })) // ouverte dans un autre onglet : l'accueil s'affiche

    await shell()
    noDialog()
  })

  it('l\'assistant ouvert avant « Lecture » ne se rouvre pas, vide, au retour de la lecture', async () => {
    const user = userEvent.setup()
    routes()
    renderApp(<AppRoutes />, { route: '/' })
    await shell()

    await user.keyboard('{Control>}j{/Control}')
    await user.type(await screen.findByLabelText('Votre message à l\'assistant'), 'un film{Enter}')
    await user.click(await screen.findByRole('button', { name: /Lecture/ }))
    await screen.findByLabelText('Lueur Boréale', { selector: 'video' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument() // pas de panneau sur la page de lecture

    await user.keyboard('{Escape}')

    await shell()
    noDialog()
  })

  it('sur une page normale, les raccourcis fonctionnent toujours', async () => {
    const user = userEvent.setup()
    routes()
    renderApp(<AppRoutes />, { route: '/' })
    await shell()

    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('dialog', { name: 'Palette de commandes' })).toBeInTheDocument()
    await user.keyboard('{Escape}{Control>}j{/Control}')
    expect(await screen.findByRole('dialog', { name: /Assistant/ })).toBeInTheDocument()
  })
})
