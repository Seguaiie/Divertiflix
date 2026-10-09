import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeCard, mockApi, PROFILE_ID, renderApp, signIn } from '../test/utils'
import { useUI } from '../state/ui'
import { AssistantPanel } from './AssistantPanel'

const Open = () => { const ui = useUI(); useEffect(() => ui.setAssistantOpen(true), []); return null } // eslint-disable-line react-hooks/exhaustive-deps
const home = { hero: [], rows: [] }
const reply = (over: object) => ({ reply: 'found', param: null, unknownTitle: null, understood: [], steps: [], cards: [], ...over })

beforeEach(() => signIn())

describe('AssistantPanel', () => {
  it('envoie la demande avec le profil et la langue, puis affiche les cartes avec leur raison', async () => {
    const user = userEvent.setup()
    const card = makeCard({ reason: { type: 'genreAffinity', titleId: null, title: null, genre: 'Thriller', tags: null } })
    const { calls } = mockApi({
      '/api/home': home,
      'POST /api/assistant/chat': reply({ understood: [{ kind: 'genre', label: 'Thriller' }, { kind: 'short', label: '90' }], steps: [{ key: 'catalog', count: 31 }], cards: [card] }),
    })
    renderApp(<><Open /><AssistantPanel /></>)
    const input = await screen.findByLabelText('Votre message à l\'assistant')
    await user.type(input, 'un thriller court')
    await user.click(screen.getByRole('button', { name: 'Envoyer' }))

    // La réponse est aussi annoncée dans une région aria-live masquée : deux occurrences, une visible et une pour les lecteurs d'écran.
    expect((await screen.findAllByText('Voici un titre qui correspond à votre demande.')).length).toBe(2)
    expect(calls.find(c => c.path === '/api/assistant/chat')?.body).toEqual({ profileId: PROFILE_ID, message: 'un thriller court', locale: 'fr' })
    expect(screen.getByText('Lueur Boréale')).toBeInTheDocument()
    expect(screen.getByText(/Thriller/, { selector: '.ac-why' })).toBeInTheDocument()
  })

  it('une suggestion s\'envoie d\'un clic', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi({ '/api/home': home, 'POST /api/assistant/chat': reply({ reply: 'nothing' }) })
    renderApp(<><Open /><AssistantPanel /></>)
    await user.click(await screen.findByRole('button', { name: 'Quelque chose de court ce soir' }))
    expect((await screen.findAllByText(/rien trouvé/)).length).toBeGreaterThan(0)
    expect(calls.find(c => c.path === '/api/assistant/chat')?.body).toMatchObject({ message: 'Quelque chose de court ce soir' })
  })

  it('admet un titre inconnu au lieu de l\'inventer', async () => {
    const user = userEvent.setup()
    mockApi({ '/api/home': home, 'POST /api/assistant/chat': reply({ reply: 'similarUnknown', param: 'Zorglub' }) })
    renderApp(<><Open /><AssistantPanel /></>)
    await user.type(await screen.findByLabelText('Votre message à l\'assistant'), 'comme Zorglub{Enter}')
    expect((await screen.findAllByText(/Zorglub/)).length).toBeGreaterThan(0)
  })

  it('affiche une erreur claire si l\'assistant échoue, sans casser le panneau', async () => {
    const user = userEvent.setup()
    mockApi({ '/api/home': home, 'POST /api/assistant/chat': { status: 500, body: { title: 'x' } } })
    renderApp(<><Open /><AssistantPanel /></>)
    await user.type(await screen.findByLabelText('Votre message à l\'assistant'), 'bonjour{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('n\'a pas pu répondre')
    expect(screen.getByLabelText('Votre message à l\'assistant')).toBeEnabled()
  })

  it('Entrée envoie, Maj+Entrée ajoute une ligne, et un message vide ne part pas', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi({ '/api/home': home, 'POST /api/assistant/chat': reply({ reply: 'help' }) })
    renderApp(<><Open /><AssistantPanel /></>)
    const input = await screen.findByLabelText('Votre message à l\'assistant')
    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeDisabled()
    await user.type(input, '   {Enter}')
    expect(calls.filter(c => c.path === '/api/assistant/chat')).toHaveLength(0)
    await user.clear(input)
    await user.type(input, 'ligne un{Shift>}{Enter}{/Shift}ligne deux')
    expect(input).toHaveValue('ligne un\nligne deux')
    await user.keyboard('{Enter}')
    expect(await screen.findByText(/ligne un/, { selector: '.as-msg.user p' })).toBeInTheDocument()
  })
})
