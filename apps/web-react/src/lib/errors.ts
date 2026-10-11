import type { Key } from '../i18n'
import { ApiError } from './api'

/**
 * Texte d'erreur à montrer à la personne, toujours dans la langue de l'interface : le message brut de l'API
 * (en français, parfois vide ou technique) n'est jamais affiché. On s'appuie sur le statut HTTP ; `overrides` donne,
 * pour un statut précis, la phrase propre à l'action (par exemple le 409 d'une demande en double).
 */
export function errorText(e: unknown, t: (key: Key) => string, overrides: Partial<Record<number, Key>> = {}): string {
  const status = e instanceof ApiError ? e.status : -1
  const key = overrides[status]
    ?? (status === 0 ? 'error.network'
      : status === 400 || status === 422 ? 'error.invalid'
      : status === 429 ? 'error.rateLimited'
      : status >= 500 ? 'error.server'
      : 'error.generic')
  return t(key)
}

/**
 * Mot de passe refusé à l'inscription par la politique de l'API (400, raison en français dans le message) : la clé de la phrase exacte
 * dans la langue de l'interface, ou null si la 400 a une autre cause. L'API ne joint pas de code stable : on reconnaît ses deux motifs.
 */
export function passwordRefusal(e: unknown): Key | null {
  if (!(e instanceof ApiError) || e.status !== 400) return null
  if (/trop courant/i.test(e.message)) return 'auth.passwordCommon'
  if (/votre courriel/i.test(e.message)) return 'auth.passwordIsEmail'
  return null
}
