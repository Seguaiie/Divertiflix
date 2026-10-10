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

/**
 * Verrou partagé entre les onglets du navigateur quand il existe (navigator.locks) ; sinon, ou s'il est refusé (origine opaque,
 * page sandboxée), on s'en passe. `fn` ne rejette jamais : la relancer après un refus du verrou est sans risque.
 */
function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const locked = navigator.locks?.request('divertiflix-refresh', fn)
    return locked ? locked.catch(() => fn()) : fn()
  } catch { return fn() }
}

/**
 * Un seul refresh à la fois : le jeton de rafraîchissement est à usage unique (rotation côté API).
 * Seul un 400 ou un 401 signifie que ce jeton est mort : un 429 ou un 5xx (limiteur, redéploiement) est passager, la session reste.
 * Entre onglets, celui qui perd la course reçoit un 401 alors que le gagnant a déjà écrit la session suivante : on la reprend.
 */
export function refresh(): Promise<string | null> {
  refreshing ??= (async () => {
    const before = session.get()
    if (!before) return null
    return withRefreshLock(async () => {
      const s = session.get()
      if (!s) return null
      if (s.refreshToken !== before.refreshToken) return s.accessToken // un autre onglet a renouvelé pendant l'attente du verrou
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: s.refreshToken }),
        })
        if (res.status === 400 || res.status === 401) {
          const now = session.get()
          if (now && now.refreshToken !== s.refreshToken) return now.accessToken // sans verrou, l'autre onglet a gagné la rotation
          session.clear(); window.dispatchEvent(new Event(LOGOUT_EVENT)); return null
        }
        if (!res.ok) return null // panne passagère : on garde la session, on réessaiera
        const data = (await res.json()) as AuthResponse
        session.set(data) // met aussi à jour l'utilisateur : un rôle modifié côté serveur se voit sans reconnexion
        window.dispatchEvent(new CustomEvent('divertiflix:user', { detail: data.user }))
        return data.accessToken
      } catch { return null } // réseau coupé : on garde la session, on réessaiera
    })
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

/** Erreur d'appel. Le message est technique (texte du serveur, en français) et n'est jamais affiché tel quel : l'interface passe par errorText. */
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
