import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

interface UIState {
  assistantOpen: boolean
  setAssistantOpen(v: boolean): void
  /** Ouvre l'assistant en lui posant tout de suite une question (depuis la palette de commandes). */
  askAssistant(message: string): void
  assistantPrompt: string | null
  clearAssistantPrompt(): void
  paletteOpen: boolean
  setPaletteOpen(v: boolean): void
  request: { open: boolean; prefill: string }
  openRequest(prefill?: string): void
  closeRequest(): void
  /** `opener` : l'élément qui avait le focus à l'ouverture, pour le lui rendre à la fermeture (le bouton flottant disparaît pendant l'ouverture). */
  support: { open: boolean; ticketId: string | null; opener: HTMLElement | null }
  openSupport(ticketId?: string | null): void
  closeSupport(): void
  /** Ferme tous les dialogues : la coque qui les porte disparaît (lecture, connexion), ils ne doivent pas s'y retrouver ouverts au retour. */
  closeAll(): void
}

const Ctx = createContext<UIState | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [assistantPrompt, setAssistantPrompt] = useState<string | null>(null)
  const [request, setRequest] = useState({ open: false, prefill: '' })
  const [support, setSupport] = useState<UIState['support']>({ open: false, ticketId: null, opener: null })

  const openRequest = useCallback((prefill = '') => setRequest({ open: true, prefill }), [])
  const closeRequest = useCallback(() => setRequest(r => ({ ...r, open: false })), [])
  const openSupport = useCallback((ticketId: string | null = null) => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null // lu avant le rendu : le déclencheur est encore là
    setSupport(s => ({ open: true, ticketId, opener: s.open ? s.opener : active })) // rouvrir un billet depuis le panneau ne change pas le déclencheur
  }, [])
  const closeSupport = useCallback(() => setSupport(s => ({ ...s, open: false })), [])

  const closeAll = useCallback(() => {
    setAssistantOpen(false); setPaletteOpen(false); setAssistantPrompt(null)
    setRequest({ open: false, prefill: '' }); setSupport({ open: false, ticketId: null, opener: null })
  }, [])

  const askAssistant = useCallback((message: string) => { setAssistantPrompt(message); setAssistantOpen(true) }, [])
  const clearAssistantPrompt = useCallback(() => setAssistantPrompt(null), [])

  const value = useMemo<UIState>(() => ({
    assistantOpen, setAssistantOpen, askAssistant, assistantPrompt, clearAssistantPrompt, paletteOpen, setPaletteOpen, request, openRequest, closeRequest, support, openSupport, closeSupport, closeAll,
  }), [assistantOpen, assistantPrompt, askAssistant, clearAssistantPrompt, paletteOpen, request, support, openRequest, closeRequest, openSupport, closeSupport, closeAll])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUI() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useUI hors UIProvider')
  return c
}
