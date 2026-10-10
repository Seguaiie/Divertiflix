import { createApiClient } from '@divertiflix/api-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, call, LOGOUT_EVENT, refresh, session, type AuthResponse } from './api'
import { makeSession } from '../test/utils'

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('client API : rafraîchissement sur 401', () => {
  it('rejoue une requête POST avec son corps intact et le nouveau jeton', async () => {
    const seen: { auth: string | null; body: string }[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const req = input as Request
      seen.push({ auth: req.headers.get('Authorization'), body: await req.clone().text() })
      return seen.length === 1 ? json(401) : json(200, { ok: true })
    })
    let token = 'vieux'
    const refresh = vi.fn(async () => { token = 'neuf'; return token })
    const api = createApiClient('http://x.test', { getAccessToken: () => token, refresh }, fetchImpl as never)

    const res = await api.POST('/api/requests', { body: { name: 'Nosferatu', kind: 'Movie', year: 1922, note: null } as never })

    expect(res.response.status).toBe(200)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(2)
    expect(seen[0]!.auth).toBe('Bearer vieux')
    expect(seen[1]!.auth).toBe('Bearer neuf')
    expect(JSON.parse(seen[1]!.body)).toMatchObject({ name: 'Nosferatu', year: 1922 })
  })

  it('ne tente pas de refresh pour les appels /api/auth/', async () => {
    const fetchImpl = vi.fn(async () => json(401))
    const refresh = vi.fn(async () => 'x')
    const api = createApiClient('http://x.test', { getAccessToken: () => null, refresh }, fetchImpl as never)
    const res = await api.POST('/api/auth/login', { body: { email: 'a', password: 'b' } })
    expect(res.response.status).toBe(401)
    expect(refresh).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rend la 401 telle quelle quand la session est perdue', async () => {
    const fetchImpl = vi.fn(async () => json(401))
    const api = createApiClient('http://x.test', { getAccessToken: () => 'a', refresh: async () => null }, fetchImpl as never)
    const res = await api.GET('/api/notifications')
    expect(res.response.status).toBe(401)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('une seule relance par requête : une seconde 401 est renvoyée', async () => {
    const fetchImpl = vi.fn(async () => json(401))
    const refresh = vi.fn(async () => 'neuf')
    const api = createApiClient('http://x.test', { getAccessToken: () => 'a', refresh }, fetchImpl as never)
    const res = await api.GET('/api/notifications')
    expect(res.response.status).toBe(401)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('refresh : la session ne meurt que si le serveur refuse le jeton', () => {
  const start = (over: Partial<AuthResponse> = {}) => localStorage.setItem('divertiflix.session', JSON.stringify(makeSession({ refreshToken: 'r1', accessToken: 'vieux', ...over })))
  const onLogout = vi.fn()
  const listen = () => { onLogout.mockClear(); window.addEventListener(LOGOUT_EVENT, onLogout) }
  afterEach(() => { window.removeEventListener(LOGOUT_EVENT, onLogout); vi.unstubAllGlobals() })

  it.each([429, 500, 502, 503])('une réponse %i (panne passagère) garde la session et ne déconnecte pas', async status => {
    start(); listen()
    vi.stubGlobal('fetch', vi.fn(async () => json(status)))
    expect(await refresh()).toBeNull()
    expect(session.get()?.refreshToken).toBe('r1')
    expect(onLogout).not.toHaveBeenCalled()
  })

  it('un réseau coupé garde la session', async () => {
    start(); listen()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    expect(await refresh()).toBeNull()
    expect(session.get()).not.toBeNull()
    expect(onLogout).not.toHaveBeenCalled()
  })

  it.each([400, 401])('un %i (jeton mort) vide la session et prévient l\'interface', async status => {
    start(); listen()
    vi.stubGlobal('fetch', vi.fn(async () => json(status)))
    expect(await refresh()).toBeNull()
    expect(session.get()).toBeNull()
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('un succès enregistre la nouvelle session et renvoie le jeton d\'accès', async () => {
    start()
    vi.stubGlobal('fetch', vi.fn(async () => json(200, makeSession({ accessToken: 'neuf', refreshToken: 'r2' }))))
    expect(await refresh()).toBe('neuf')
    expect(session.get()).toMatchObject({ accessToken: 'neuf', refreshToken: 'r2' })
  })

  it('perdre la course contre un autre onglet reprend son jeton au lieu de déconnecter', async () => {
    start(); listen()
    vi.stubGlobal('fetch', vi.fn(async () => {
      // Pendant que notre requête est en vol, l'autre onglet a gagné la rotation et écrit sa session.
      localStorage.setItem('divertiflix.session', JSON.stringify(makeSession({ accessToken: 'celui-de-l-autre', refreshToken: 'r2' })))
      return json(401)
    }))
    expect(await refresh()).toBe('celui-de-l-autre')
    expect(session.get()?.refreshToken).toBe('r2')
    expect(onLogout).not.toHaveBeenCalled()
  })

  it('avec navigator.locks, un onglet qui attendait le verrou reprend la session déjà renouvelée sans rappeler le serveur', async () => {
    start()
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const request = vi.fn(async (_name: string, cb: () => Promise<unknown>) => { await gate; return cb() })
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    const fetchSpy = vi.fn(async () => json(200, makeSession()))
    vi.stubGlobal('fetch', fetchSpy)

    const pending = refresh()
    // L'autre onglet détient le verrou, renouvelle, puis le libère.
    localStorage.setItem('divertiflix.session', JSON.stringify(makeSession({ accessToken: 'deja-renouvele', refreshToken: 'r2' })))
    release()

    expect(await pending).toBe('deja-renouvele')
    expect(request).toHaveBeenCalledWith('divertiflix-refresh', expect.any(Function))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('refresh : verrou refusé', () => {
  it('si navigator.locks refuse (page sandboxée), le refresh a lieu quand même', async () => {
    localStorage.setItem('divertiflix.session', JSON.stringify(makeSession({ refreshToken: 'r1' })))
    vi.stubGlobal('navigator', { ...navigator, locks: { request: vi.fn(() => Promise.reject(new DOMException('opaque', 'SecurityError'))) } })
    vi.stubGlobal('fetch', vi.fn(async () => json(200, makeSession({ accessToken: 'neuf', refreshToken: 'r2' }))))
    expect(await refresh()).toBe('neuf')
  })
})

describe('call : erreurs normalisées', () => {
  it('une panne réseau devient une ApiError de statut 0', async () => {
    const err = await call(Promise.reject(new TypeError('x'))).catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(0)
  })
})
