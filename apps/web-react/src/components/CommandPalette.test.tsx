import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { Route, Routes, useLocation } from 'react-router-dom'
import { makeTitle, mockApi, renderApp, signIn } from '../test/utils'
import { CommandPalette } from './CommandPalette'

const Where = () => <p data-testid="where">{useLocation().pathname}</p>
const Harness = () => <><CommandPalette /><Routes><Route path="*" element={<Where />} /></Routes></>

beforeEach(() => signIn())

describe('CommandPalette', () => {
  it('s\'ouvre avec Ctrl+K, se ferme avec Échap et rend le focus', async () => {
    mockApi({})
    const user = userEvent.setup()
    renderApp(<Harness />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('combobox')).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('« / » ouvre la palette hors des champs de saisie seulement', async () => {
    mockApi({})
    const user = userEvent.setup()
    renderApp(<><input aria-label="champ" /><Harness /></>)
    await user.click(screen.getByLabelText('champ'))
    await user.keyboard('/')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(document.body)
    await user.keyboard('/')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('filtre les actions au clavier et navigue avec Entrée', async () => {
    mockApi({})
    const user = userEvent.setup()
    renderApp(<Harness />)
    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByRole('combobox'), 'ma list')
    // Une phrase de 4 caractères ou plus propose aussi de la confier à l'assistant : l'action reste sélectionnable au clavier.
    expect(screen.getByRole('option', { name: /Ma liste/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Accueil/ })).not.toBeInTheDocument()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByTestId('where')).toHaveTextContent('/ma-liste')
  })

  it('cherche des titres côté serveur après 2 caractères et ouvre la fiche', async () => {
    const user = userEvent.setup()
    const t = makeTitle({ name: 'Spring' })
    const { calls } = mockApi({ '/api/titles': { items: [t], total: 1, page: 1, pageSize: 7 } })
    renderApp(<Harness />)
    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByRole('combobox'), 'spr')
    const opt = await screen.findByRole('option', { name: /Spring/ })
    expect(calls.find(c => c.path === '/api/titles')).toBeTruthy()
    await user.click(opt)
    expect(screen.getByTestId('where')).toHaveTextContent(`/titres/${t.id}`)
  })

  it('propose de demander à l\'assistant pour une phrase longue', async () => {
    mockApi({ '/api/titles': { items: [], total: 0, page: 1, pageSize: 7 } })
    const user = userEvent.setup()
    renderApp(<Harness />)
    await act(async () => { await user.keyboard('{Control>}k{/Control}') })
    await user.type(await screen.findByRole('combobox'), 'un film court et drole')
    expect(await screen.findByRole('option', { name: /Demander à l'assistant/ })).toBeInTheDocument()
  })
})
