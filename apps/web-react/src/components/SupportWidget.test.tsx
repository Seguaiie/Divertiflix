import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi, renderApp, signIn } from '../test/utils'
import { useUI } from '../state/ui'
import { SupportWidget } from './SupportWidget'

beforeEach(() => signIn())

const FromMenu = () => { const ui = useUI(); return <button onClick={() => ui.openSupport()}>Aide du menu</button> }

const TICKET = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', subject: 'Le son saute', category: 'Playback', status: 'Open', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
const thread = { ticket: TICKET, messages: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', fromStaff: false, body: 'Le son saute à 10 minutes.', at: '2026-01-01T00:00:00Z' }] }

describe('SupportWidget', () => {
  it('rouvrir le même billet après « Retour » affiche de nouveau son fil', async () => {
    const user = userEvent.setup()
    mockApi({ '/api/support/tickets': [TICKET], [`/api/support/tickets/${TICKET.id}`]: thread })
    renderApp(<SupportWidget />)
    await user.click(screen.getByRole('button', { name: 'Ouvrir l\'aide' }))

    await user.click(await screen.findByRole('button', { name: /Le son saute/ }))
    expect(await screen.findByText('Le son saute à 10 minutes.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retour' }))
    expect(screen.queryByText('Le son saute à 10 minutes.')).not.toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /Le son saute/ }))
    expect(await screen.findByText('Le son saute à 10 minutes.')).toBeInTheDocument()
  })

  it('un billet créé s\'ouvre, et « Retour » ramène à la liste', async () => {
    const user = userEvent.setup()
    mockApi({ '/api/support/tickets': [], 'POST /api/support/tickets': thread, [`/api/support/tickets/${TICKET.id}`]: thread })
    renderApp(<SupportWidget />)
    await user.click(screen.getByRole('button', { name: 'Ouvrir l\'aide' }))
    await user.click(await screen.findByRole('button', { name: 'Nouveau billet' }))
    await user.type(screen.getByLabelText('Sujet'), 'Le son saute')
    await user.type(screen.getByLabelText('Message'), 'Le son saute à 10 minutes.')
    await user.click(screen.getByRole('button', { name: 'Envoyer' }))
    expect(await screen.findByText('Le son saute à 10 minutes.', { selector: 'p' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retour' }))
    expect(await screen.findByRole('button', { name: 'Nouveau billet' })).toBeInTheDocument()
  })

  it('Échap ferme l\'aide et rend le focus au bouton flottant, qui a été remonté entre-temps', async () => {
    const user = userEvent.setup()
    mockApi({ '/api/support/tickets': [] })
    renderApp(<SupportWidget />)
    await user.click(screen.getByRole('button', { name: 'Ouvrir l\'aide' }))
    expect(screen.queryByRole('button', { name: 'Ouvrir l\'aide' })).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Ouvrir l\'aide' })).toHaveFocus()
  })

  it('ouverte depuis un autre bouton (menu du profil, pied de page), l\'aide lui rend le focus', async () => {
    const user = userEvent.setup()
    mockApi({ '/api/support/tickets': [] })
    renderApp(<><FromMenu /><SupportWidget /></>)
    const opener = screen.getByRole('button', { name: 'Aide du menu' })
    await user.click(opener)
    await screen.findByRole('button', { name: 'Nouveau billet' })

    await user.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(opener).toHaveFocus()
  })

  it('rouvrir un billet depuis la liste ne change pas le déclencheur', async () => {
    const user = userEvent.setup()
    mockApi({ '/api/support/tickets': [TICKET], [`/api/support/tickets/${TICKET.id}`]: thread })
    renderApp(<><FromMenu /><SupportWidget /></>)
    const opener = screen.getByRole('button', { name: 'Aide du menu' })
    await user.click(opener)
    await user.click(await screen.findByRole('button', { name: /Le son saute/ })) // le focus est alors dans le panneau
    await screen.findByText('Le son saute à 10 minutes.')

    await user.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(opener).toHaveFocus()
  })

  it('la liste des messages d\'un billet ne contient que des éléments de liste', async () => {
    const user = userEvent.setup()
    mockApi({ '/api/support/tickets': [TICKET], [`/api/support/tickets/${TICKET.id}`]: thread })
    renderApp(<SupportWidget />)
    await user.click(screen.getByRole('button', { name: 'Ouvrir l\'aide' }))
    await user.click(await screen.findByRole('button', { name: /Le son saute/ }))
    await screen.findByText('Le son saute à 10 minutes.')

    const children = [...document.querySelector('.sp-msgs')!.children]
    expect(children).toHaveLength(1)
    expect(children.every(c => c.tagName === 'LI')).toBe(true)
  })
})
