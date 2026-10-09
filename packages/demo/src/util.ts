export type J = Record<string, any>

export const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => ((Math.random() * 16) | 0).toString(16))

/** Minuscules, sans accents, ponctuation en espaces : même normalisation que la recherche du serveur. */
export const normalize = (s: string | null | undefined): string =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export const nowIso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString()
export const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000

const b64url = (o: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))

/** Faux JWT (non signé) : porte le rôle pour que le faux serveur applique les mêmes règles d'accès que le vrai. */
export function fakeJwt(user: { id: string; email: string; role: string }): string {
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: user.id, email: user.email, role: user.role, exp })}.demo`
}

export function readJwt(token: string | null | undefined): { sub: string; email: string; role: string } | null {
  try {
    const p = token?.replace(/^Bearer\s+/i, '').split('.')[1]
    return p ? JSON.parse(unb64url(p)) : null
  } catch { return null }
}

/** Générateur déterministe : le même jour et la même graine donnent la même sélection « surprise ». */
export function rng(seed: number) {
  let a = seed | 0
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export const problem = (status: number, detail: string): { status: number; json: J } => ({
  status, json: { title: status === 409 ? 'Conflict' : status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : status === 401 ? 'Unauthorized' : 'Bad Request', status, detail, error: detail },
})
