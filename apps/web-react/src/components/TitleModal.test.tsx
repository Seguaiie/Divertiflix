import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppRoutes } from '../App'
import { makeCard, mockApi, PROFILE_ID, renderApp, signIn } from '../test/utils'

beforeEach(() => signIn())

const A = makeCard({}, { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Atlas de poche' })
const B = makeCard({}, { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Brume d\'automne' })
const detail = (card: typeof A, similar: (typeof A)[]) => ({ card, similar, request: null })

function routes() {
  return mockApi({
    '/api/profiles': [{ id: PROFILE_ID, name: 'Camille' }],
    '/api/titles/genres': [],
    '/api/titles': { items: [A.title], page: 1, pageSize: 24, total: 1 },
    [`/api/profiles/${PROFILE_ID}/watchlist`]: [],
    [`/api/titles/${A.title.id}/detail`]: detail(A, [B]),
    [`/api/titles/${B.title.id}/detail`]: detail(B, [A]),
  })
}

const dialogs = () => document.querySelectorAll('[role=dialog][aria-modal=true]')

describe('fiche d\'un titre : titres similaires', () => {
  it('ouvrir un titre similaire remplace la fiche : une seule fenêtre, la même page derrière, un seul retour', async () => {
    const user = userEvent.setup()
    routes()
    renderApp(<AppRoutes />, { route: '/films' })

    await user.click(await screen.findByRole('link', { name: /Atlas de poche/ }))
    const first = await screen.findByRole('dialog')
    await user.click(await within(first).findByRole('link', { name: /Brume d'automne/ }))

    expect(await screen.findByRole('heading', { level: 2, name: 'Brume d\'automne' })).toBeInTheDocument()
    expect(dialogs()).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Films' })).toBeInTheDocument() // la page d'origine, pas l'accueil

    await user.keyboard('{Escape}') // un seul Échap suffit à revenir à la liste
    expect(dialogs()).toHaveLength(0)
    expect(screen.getByRole('heading', { level: 1, name: 'Films' })).toBeInTheDocument()
  })

  it('depuis un lien direct, un titre similaire remplace aussi la fiche sans s\'empiler', async () => {
    const user = userEvent.setup()
    routes()
    renderApp(<AppRoutes />, { route: `/titres/${A.title.id}` })

    await user.click(await within(await screen.findByRole('dialog')).findByRole('link', { name: /Brume d'automne/ }))

    expect(await screen.findByRole('heading', { level: 2, name: 'Brume d\'automne' })).toBeInTheDocument()
    expect(dialogs()).toHaveLength(1)
  })
})

describe('fiche d\'un titre : superposition', () => {
  it('ouverte par un lien direct, la fiche est rendue sous <body>, hors du contexte d\'empilement de <main>', async () => {
    routes()
    renderApp(<AppRoutes />, { route: `/titres/${A.title.id}` })

    const dialog = await screen.findByRole('dialog')
    // Dans <main> (position relative, z-index 2), la fiche passerait sous la navigation, la barre d'onglets et le bouton Aide.
    expect(dialog.closest('main')).toBeNull()
    expect(dialog.closest('.overlay')?.parentElement).toBe(document.body)
  })

  it('ouverte depuis une page, la fiche est aussi sous <body>', async () => {
    const user = userEvent.setup()
    routes()
    renderApp(<AppRoutes />, { route: '/films' })

    await user.click(await screen.findByRole('link', { name: /Atlas de poche/ }))
    expect((await screen.findByRole('dialog')).closest('.overlay')?.parentElement).toBe(document.body)
  })
})
