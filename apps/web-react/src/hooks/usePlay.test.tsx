import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeCard, mockApi, renderApp, signIn } from '../test/utils'
import { PosterCard } from '../components/PosterCard'

beforeEach(() => signIn())

const ID = '11111111-1111-4111-8111-111111111111'
const external = makeCard({}, { streamKind: 'External', externalSource: 'Audiobookshelf' })

/** Fenêtre factice : window.open('', '_blank') la renvoie, l'adresse n'est visible que si le portail l'affecte. */
function fakeWindow() {
  const win = { opener: {} as unknown, close: vi.fn(), location: { href: '' } }
  vi.spyOn(window, 'open').mockReturnValue(win as never)
  return win
}

describe('lecture d\'un lien externe', () => {
  it('ouvre une adresse https dans la fenêtre préparée', async () => {
    const win = fakeWindow()
    mockApi({ [`/api/titles/${ID}/playback`]: { titleId: ID, url: 'https://abs.exemple.test/item/1', kind: 'External', startSeconds: 0, expiresAt: '2030-01-01T00:00:00Z' } })
    renderApp(<PosterCard card={external} />)
    await userEvent.setup().click(screen.getByRole('button', { name: /Lecture de|Écouter|Lire/ }))
    await waitFor(() => expect(win.location.href).toBe('https://abs.exemple.test/item/1'))
    expect(win.opener).toBeNull()
    expect(win.close).not.toHaveBeenCalled()
  })

  it.each(['javascript:document.title=1', 'data:text/html,<script>alert(1)</script>', 'vbscript:x'])('refuse %s : la fenêtre se ferme et rien n\'est exécuté', async url => {
    const win = fakeWindow()
    mockApi({ [`/api/titles/${ID}/playback`]: { titleId: ID, url, kind: 'External', startSeconds: 0, expiresAt: '2030-01-01T00:00:00Z' } })
    renderApp(<PosterCard card={external} />)
    await userEvent.setup().click(screen.getByRole('button', { name: /Lecture de|Écouter|Lire/ }))
    await waitFor(() => expect(win.close).toHaveBeenCalled())
    expect(win.location.href).toBe('')
    expect(await screen.findByText('Impossible d\'ouvrir ce titre pour le moment.')).toBeInTheDocument()
  })
})
