import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

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
  support: { open: boolean; ticketId: string | null }
  openSupport(ticketId?: string | null): void
  closeSupport(): void
}

const Ctx = createContext<UIState | null>(null)

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [assistantPrompt, setAssistantPrompt] = useState<string | null>(null)
  const [request, setRequest] = useState({ open: false, prefill: '' })
  const [support, setSupport] = useState<{ open: boolean; ticketId: string | null }>({ open: false, ticketId: null })

  const openRequest = useCallback((prefill = '') => setRequest({ open: true, prefill }), [])
  const closeRequest = useCallback(() => setRequest(r => ({ ...r, open: false })), [])
  const openSupport = useCallback((ticketId: string | null = null) => setSupport({ open: true, ticketId }), [])
  const closeSupport = useCallback(() => setSupport(s => ({ ...s, open: false })), [])

  // Raccourcis globaux : Ctrl/Cmd+K ou « / » (palette), Ctrl/Cmd+J (assistant).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o) }
      else if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); setAssistantOpen(o => !o) }
      else if (e.key === '/' && !mod && !isTyping(e.target)) { e.preventDefault(); setPaletteOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const askAssistant = useCallback((message: string) => { setAssistantPrompt(message); setAssistantOpen(true) }, [])
  const clearAssistantPrompt = useCallback(() => setAssistantPrompt(null), [])

  const value = useMemo<UIState>(() => ({
    assistantOpen, setAssistantOpen, askAssistant, assistantPrompt, clearAssistantPrompt, paletteOpen, setPaletteOpen, request, openRequest, closeRequest, support, openSupport, closeSupport,
  }), [assistantOpen, assistantPrompt, askAssistant, clearAssistantPrompt, paletteOpen, request, support, openRequest, closeRequest, openSupport, closeSupport])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUI() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useUI hors UIProvider')
  return c
}
