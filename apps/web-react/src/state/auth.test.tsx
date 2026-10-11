import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { act, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { makeSession, mockApi, PROFILE_ID, renderApp, signIn, USER_ID } from '../test/utils'
import { useAuth } from './auth'
import { useDock } from './dock'

const KEY = 'divertiflix.session'
const YVONNE = { id: '00000000-0000-4000-8000-0000000000bb', email: 'yvonne@test.com', role: 'Subscriber' } as const

const seen: { client?: QueryClient } = {}
const cache = () => seen.client!
function Probe() {
  const { user, profileId } = useAuth()
  const qc = useQueryClient()
  useEffect(() => { seen.client = qc }, [qc])
  return <><p data-testid="who">{user?.email ?? 'anonyme'}</p><p data-testid="profile">{profileId ?? 'aucun'}</p></>
}
const who = () => screen.getByTestId('who').textContent
const profile = () => screen.getByTestId('profile').textContent

/** Ce que fait un autre onglet : il écrit dans le stockage partagé, et le navigateur prévient celui-ci par un évènement `storage`. */
const otherTab = (write: () => void, key: string | null = KEY) => act(() => { write(); window.dispatchEvent(new StorageEvent('storage', { key })) })

describe('AuthProvider : session modifiée dans un autre onglet', () => {
  it('une session fermée ailleurs déconnecte cet onglet et vide le cache du compte', () => {
    signIn(); mockApi({})
    renderApp(<Probe />)
    expect(who()).toBe('camille@test.com')
    cache().setQueryData(['detail', PROFILE_ID, 'x'], { secret: true })

    otherTab(() => localStorage.removeItem(KEY))

    expect(who()).toBe('anonyme')
    expect(profile()).toBe('aucun')
    expect(cache().getQueryData(['detail', PROFILE_ID, 'x'])).toBeUndefined()
  })

  it('un autre compte connecté ailleurs devient celui de cet onglet : ni cache ni profil de l\'ancien', () => {
    signIn(); mockApi({})
    localStorage.setItem(`divertiflix.profile.${YVONNE.id}`, 'profil-yvonne')
    renderApp(<Probe />)
    cache().setQueryData(['detail', PROFILE_ID, 'x'], { secret: 'billet-de-camille' })

    otherTab(() => localStorage.setItem(KEY, JSON.stringify(makeSession({ user: YVONNE, accessToken: 'y.y.y', refreshToken: 'ry' }))))

    expect(who()).toBe('yvonne@test.com')
    expect(profile()).toBe('profil-yvonne')
    expect(cache().getQueryData(['detail', PROFILE_ID, 'x'])).toBeUndefined()
  })

  it('le même compte renouvelé ailleurs (jetons neufs) garde profil et cache', () => {
    signIn(); mockApi({})
    renderApp(<Probe />)
    cache().setQueryData(['detail', PROFILE_ID, 'x'], { ok: true })

    otherTab(() => localStorage.setItem(KEY, JSON.stringify(makeSession({ accessToken: 'n.e.uf', refreshToken: 'r2', user: { id: USER_ID, email: 'camille@test.com', role: 'Admin' } }))))

    expect(who()).toBe('camille@test.com')
    expect(profile()).toBe(PROFILE_ID)
    expect(cache().getQueryData(['detail', PROFILE_ID, 'x'])).toEqual({ ok: true })
  })

  it('une session ouverte ailleurs pendant que cet onglet est sur la connexion le fait suivre', () => {
    mockApi({})
    renderApp(<Probe />)
    expect(who()).toBe('anonyme')

    otherTab(() => localStorage.setItem(KEY, JSON.stringify(makeSession())))

    expect(who()).toBe('camille@test.com')
  })

  it('vider tout le stockage (clé nulle) déconnecte aussi, et une autre clé est ignorée', () => {
    signIn(); mockApi({})
    renderApp(<Probe />)

    otherTab(() => localStorage.setItem('divertiflix.volume', '{}'), 'divertiflix.volume')
    expect(who()).toBe('camille@test.com')

    otherTab(() => localStorage.clear(), null)
    expect(who()).toBe('anonyme')
  })

  it('un refresh qui ne trouve plus de session déconnecte l\'interface (évènement interne)', async () => {
    signIn(); mockApi({})
    renderApp(<Probe />)
    localStorage.removeItem(KEY) // vidée sans évènement storage (ex. stockage purgé) : la prochaine requête le découvre
    const { refresh } = await import('../lib/api')

    await act(async () => { await refresh() })

    expect(who()).toBe('anonyme')
  })
})

describe('AuthProvider : le livre audio d\'un compte ne passe pas au suivant', () => {
  it('un autre compte ouvert dans un autre onglet arrête l\'écoute en cours', async () => {
    const ID = '11111111-1111-4111-8111-111111111111'
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    signIn()
    mockApi({ [`/api/titles/${ID}/playback`]: { titleId: ID, url: 'https://media.test/livre.mp3', kind: 'Audio', startSeconds: 0, expiresAt: '2030-01-01T00:00:00Z' } })
    const held: { dock?: ReturnType<typeof useDock> } = {}
    function Player() {
      const dock = useDock()
      useEffect(() => { held.dock = dock })
      return <p data-testid="listening">{dock.current?.name ?? 'rien'}</p>
    }
    renderApp(<Player />)
    await act(async () => { await held.dock!.play({ id: ID, name: 'Candide', author: 'Voltaire', posterUrl: null }) })
    expect(screen.getByTestId('listening')).toHaveTextContent('Candide')
    pause.mockClear()

    localStorage.setItem(`divertiflix.profile.${YVONNE.id}`, 'profil-yvonne') // d'un profil directement à un autre, sans passer par « aucun profil »
    otherTab(() => localStorage.setItem(KEY, JSON.stringify(makeSession({ user: YVONNE, accessToken: 'y.y.y', refreshToken: 'ry' }))))

    expect(screen.getByTestId('listening')).toHaveTextContent('rien')
    expect(pause).toHaveBeenCalled()
  })
})
