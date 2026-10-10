import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi, PROFILE_ID, renderApp, signIn } from '../test/utils'
import { Nav } from './Nav'
import { RequestDialog } from './RequestDialog'

beforeEach(() => signIn())

const routes = () => mockApi({
  '/api/profiles': [{ id: PROFILE_ID, name: 'Camille' }],
  '/api/notifications': { items: [], unread: 0 },
  '/api/requests/mine': [],
})
const account = () => screen.findByRole('button', { name: 'Compte de Camille' })
const item = (name: string) => screen.getByRole('menuitem', { name })

describe('Nav : menu du profil', () => {
  it('Flèche bas sur le bouton ouvre le menu et va à la première entrée', async () => {
    const user = userEvent.setup()
    routes()
    renderApp(<Nav />)
    ;(await account()).focus()

    await user.keyboard('{ArrowDown}')
    expect(item('Changer de profil')).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Compte de Camille' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('les flèches, Début et Fin parcourent les entrées en boucle', async () => {
    const user = userEvent.setup()
    routes()
    renderApp(<Nav />)
    await user.click(await account())

    await user.keyboard('{ArrowDown}')
    expect(item('Changer de profil')).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(item('Demander un titre')).toHaveFocus()
    await user.keyboard('{End}')
    expect(item('Se déconnecter')).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(item('Changer de profil')).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(item('Se déconnecter')).toHaveFocus()
    await user.keyboard('{Home}')
    expect(item('Changer de profil')).toHaveFocus()
  })

  it('Échap referme le menu et rend le focus au bouton', async () => {
    const user = userEvent.setup()
    routes()
    renderApp(<Nav />)
    const button = await account()
    await user.click(button)
    await user.keyboard('{ArrowDown}{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('« Demander un titre » rend le focus au bouton du profil quand la fenêtre se ferme', async () => {
    const user = userEvent.setup()
    routes()
    renderApp(<><Nav /><RequestDialog /></>)
    const button = await account()
    await user.click(button)
    await user.click(item('Demander un titre'))
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(button).toHaveFocus() // sans cela, l'entrée de menu démontée laissait le focus sur <body>
  })
})
