import { useEffect } from 'react'

/** Titre d'onglet par page : indispensable pour les lecteurs d'écran et pour retrouver un onglet. */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · Divertiflix` : 'Divertiflix'
    return () => { document.title = 'Divertiflix' }
  }, [title])
}
