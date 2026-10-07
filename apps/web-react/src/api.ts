import { createApiClient, type Schemas } from '@divertiflix/api-client'

export type AuthResponse = Schemas['AuthResponse']
const KEY = 'divertiflix.session'

interface Session { accessToken: string; refreshToken: string }

export const session = {
  get(): Session | null {
    try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { return null }
  },
  set(a: AuthResponse) { localStorage.setItem(KEY, JSON.stringify({ accessToken: a.accessToken, refreshToken: a.refreshToken })) },
  clear() { localStorage.removeItem(KEY) },
}

let refreshing: Promise<string | null> | null = null

/** Un seul refresh à la fois : le refresh token est à usage unique (rotation côté API). */
async function refresh(): Promise<string | null> {
  refreshing ??= (async () => {
    const s = session.get()
    if (!s) return null
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: s.refreshToken }),
    })
    if (!res.ok) { session.clear(); window.dispatchEvent(new Event('divertiflix:logout')); return null }
    const data = (await res.json()) as AuthResponse
    session.set(data)
    return data.accessToken
  })().finally(() => { refreshing = null })
  return refreshing
}

export const api = createApiClient(location.origin, { getAccessToken: () => session.get()?.accessToken ?? null, refresh })
