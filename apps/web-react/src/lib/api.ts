import { createApiClient, type Schemas } from '@divertiflix/api-client'
import { jwtExpiry } from './jwt'

export type S = Schemas
export type AuthResponse = Schemas['AuthResponse']
export type User = AuthResponse['user']
export type Title = Schemas['TitleDto']
export type Card = Schemas['CardDto']
export type Reason = Schemas['ReasonDto']

const KEY = 'divertiflix.session'
export const LOGOUT_EVENT = 'divertiflix:logout'

interface Stored { accessToken: string; refreshToken: string; user: User }

/** Session unique (jetons et utilisateur ensemble) : un seul endroit à vider à la déconnexion. */
export const session = {
  get(): Stored | null {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null
      return v?.accessToken && v.refreshToken && v.user ? v : null
    } catch { return null }
  },
  set(a: AuthResponse) {
    try { localStorage.setItem(KEY, JSON.stringify({ accessToken: a.accessToken, refreshToken: a.refreshToken, user: a.user })) } catch { /* stockage indisponible */ }
  },
  clear() { try { localStorage.removeItem(KEY) } catch { /* stockage indisponible */ } },
}

let refreshing: Promise<string | null> | null = null

/** Un seul refresh à la fois : le jeton de rafraîchissement est à usage unique (rotation côté API). */
export function refresh(): Promise<string | null> {
  refreshing ??= (async () => {
    const s = session.get()
    if (!s) return null
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: s.refreshToken }),
      })
      if (!res.ok) { session.clear(); window.dispatchEvent(new Event(LOGOUT_EVENT)); return null }
      const data = (await res.json()) as AuthResponse
      session.set(data) // met aussi à jour l'utilisateur : un rôle modifié côté serveur se voit sans reconnexion
      window.dispatchEvent(new CustomEvent('divertiflix:user', { detail: data.user }))
      return data.accessToken
    } catch { return null } // réseau coupé : on garde la session, on réessaiera
  })().finally(() => { refreshing = null })
  return refreshing
}

/** Jeton valable pour au moins 20 s : renouvelé d'avance (connexion SignalR, lecture longue). */
export async function freshAccessToken(): Promise<string> {
  const s = session.get()
  if (!s) return ''
  const exp = jwtExpiry(s.accessToken)
  if (exp !== null && exp - Date.now() / 1000 < 20) return (await refresh()) ?? ''
  return s.accessToken
}

export const api = createApiClient(location.origin, { getAccessToken: () => session.get()?.accessToken ?? null, refresh })

/** Message lisible d'une réponse d'erreur : problem+json (detail), ancien format { error }, ou repli. */
export function problemText(error: unknown, fallback: string): string {
  const e = error as { error?: string; detail?: string; errors?: Record<string, string[]> } | undefined
  if (e?.error) return e.error
  if (e?.detail) return e.detail
  const first = e?.errors ? Object.values(e.errors).flat()[0] : undefined
  return first ?? fallback
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

/** Déballe une réponse openapi-fetch : renvoie les données ou lève une ApiError au message exploitable. */
export async function call<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>, fallback = 'Erreur inattendue.'): Promise<T> {
  let r
  try { r = await p } catch { throw new ApiError('network', 0) }
  if (r.error !== undefined || !r.response.ok) throw new ApiError(problemText(r.error, fallback), r.response.status)
  return r.data as T
}
