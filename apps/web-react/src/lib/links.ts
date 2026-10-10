import type { Location } from 'react-router-dom'

/** Seules les adresses http(s) sont ouvertes depuis le portail : javascript:, data: ou vbscript: s'exécuteraient avec les droits du portail. */
export function isWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url, location.href).protocol // l'analyseur du navigateur, donc la même lecture que pour location.href
    return protocol === 'http:' || protocol === 'https:'
  } catch { return false }
}

/**
 * Lien vers la fiche d'un titre. La fiche s'ouvre par-dessus la page d'origine (`background`). Depuis une fiche déjà ouverte
 * (« Titres similaires »), elle la remplace au lieu de s'empiler : une seule fenêtre, la même page derrière, un seul cran d'historique.
 */
export function titleLink(from: Location, id: string) {
  const background = (from.state as { background?: Location } | null)?.background
  const inSheet = from.pathname.startsWith('/titres/')
  return { to: `/titres/${id}`, replace: inSheet, state: inSheet ? (background ? { background } : undefined) : { background: from } }
}
