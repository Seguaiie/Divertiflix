import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeCard, mockApi, PROFILE_ID, renderApp, signIn } from '../test/utils'
import { useUI } from '../state/ui'
import { AssistantPanel } from './AssistantPanel'

const Opener = () => { const ui = useUI(); return <button onClick={() => ui.setAssistantOpen(true)}>Ouvrir le panneau</button> }
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

  it('le bouton de liste d\'une carte suit la liste du profil : ajout, retrait, et état lu dans le cache', async () => {
    const user = userEvent.setup()
    const card = makeCard()
    const url = `/api/profiles/${PROFILE_ID}/watchlist/${card.title.id}`
    let listed = false // la liste côté serveur
    const { calls } = mockApi({
      '/api/home': home,
      'POST /api/assistant/chat': reply({ cards: [card] }),
      [`/api/profiles/${PROFILE_ID}/watchlist`]: () => (listed ? [{ ...card, inWatchlist: true }] : []),
      [`PUT ${url}`]: () => { listed = true; return { status: 204 } },
      [`DELETE ${url}`]: () => { listed = false; return { status: 204 } },
    })
    renderApp(<><Open /><AssistantPanel /></>)
    await user.type(await screen.findByLabelText('Votre message à l\'assistant'), 'un thriller{Enter}')

    const add = await screen.findByRole('button', { name: 'Ajouter Lueur Boréale à ma liste' })
    expect(add).toHaveAttribute('aria-pressed', 'false')
    await user.click(add)
    const remove = await screen.findByRole('button', { name: 'Retirer Lueur Boréale de ma liste' })
    expect(remove).toHaveAttribute('aria-pressed', 'true')

    await user.click(remove)
    expect(await screen.findByRole('button', { name: 'Ajouter Lueur Boréale à ma liste' })).toHaveAttribute('aria-pressed', 'false')
    expect(calls.filter(c => c.path === url).map(c => c.method)).toEqual(['PUT', 'DELETE'])
  })

  it('une carte déjà dans la liste du profil s\'affiche comme telle, même si la réponse du chat est périmée', async () => {
    const user = userEvent.setup()
    const card = makeCard({ inWatchlist: false })
    mockApi({
      '/api/home': home,
      'POST /api/assistant/chat': reply({ cards: [card] }),
      [`/api/profiles/${PROFILE_ID}/watchlist`]: [{ ...card, inWatchlist: true }],
    })
    renderApp(<><Open /><AssistantPanel /></>)
    await user.type(await screen.findByLabelText('Votre message à l\'assistant'), 'un thriller{Enter}')
    expect(await screen.findByRole('button', { name: 'Retirer Lueur Boréale de ma liste' })).toHaveAttribute('aria-pressed', 'true')
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

describe('AssistantPanel : fenêtre modale', () => {
  it('est une boîte de dialogue modale nommée, et le focus entre dans le champ de saisie', async () => {
    const user = userEvent.setup()
    mockApi({ '/api/home': home })
    renderApp(<><Opener /><AssistantPanel /></>)
    await user.click(screen.getByRole('button', { name: 'Ouvrir le panneau' }))

    const dialog = await screen.findByRole('dialog', { name: 'Assistant' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    await waitFor(() => expect(screen.getByLabelText('Votre message à l\'assistant')).toHaveFocus())
  })

  it('Échap ferme le panneau et rend le focus au bouton qui l\'avait ouvert', async () => {
    const user = userEvent.setup()
    mockApi({ '/api/home': home })
    renderApp(<><Opener /><AssistantPanel /></>)
    const opener = screen.getByRole('button', { name: 'Ouvrir le panneau' })
    await user.click(opener)
    await screen.findByRole('dialog', { name: 'Assistant' })

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('un clic sur le voile ferme le panneau, un clic dans le panneau non', async () => {
    const user = userEvent.setup()
    mockApi({ '/api/home': home })
    renderApp(<><Opener /><AssistantPanel /></>)
    await user.click(screen.getByRole('button', { name: 'Ouvrir le panneau' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assistant' })

    fireEvent.mouseDown(dialog)
    expect(screen.getByRole('dialog', { name: 'Assistant' })).toBeInTheDocument()
    fireEvent.mouseDown(dialog.parentElement!) // le voile
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('le bouton Fermer ferme le panneau et bloque puis rend le défilement du fond', async () => {
    const user = userEvent.setup()
    mockApi({ '/api/home': home })
    renderApp(<><Opener /><AssistantPanel /></>)
    await user.click(screen.getByRole('button', { name: 'Ouvrir le panneau' }))
    await screen.findByRole('dialog', { name: 'Assistant' })
    expect(document.body.style.overflow).toBe('hidden')

    await user.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })
})
