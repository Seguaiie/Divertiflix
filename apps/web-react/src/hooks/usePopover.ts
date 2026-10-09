import { useCallback, useEffect, useRef, useState } from 'react'

/** Popover simple : se ferme au clic extérieur et à Échap (en rendant le focus au déclencheur). */
export function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) ref.current?.querySelector<HTMLElement>('[data-popover-trigger]')?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, close])

  return { open, setOpen, close, ref }
}
