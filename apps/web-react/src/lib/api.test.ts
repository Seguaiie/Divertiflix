import { createApiClient } from '@divertiflix/api-client'
import { describe, expect, it, vi } from 'vitest'

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
