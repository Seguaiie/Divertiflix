import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * Dialogues ouverts, du plus ancien au plus récent (la fiche d'un titre peut s'ouvrir par-dessus l'assistant, la palette par-dessus la fiche).
 * Seul le dernier réagit à Échap et à Tab ; le fond reste verrouillé tant qu'il en reste un.
 */
const stack: object[] = []
/** L'élément qui avait le focus avant le premier dialogue : repli quand le déclencheur du dernier a disparu (fiche remplacée par une autre depuis l'assistant). */
let origin: HTMLElement | null = null
let lock: { overflow: string; padding: string } | null = null

/**
 * Comportement de dialogue accessible : focus piégé, Échap, retour du focus à l'élément d'origine, défilement du fond bloqué.
 * Le conteneur doit porter role="dialog" et aria-modal="true".
 */
export function useDialog(open: boolean, onClose: () => void, ref: RefObject<HTMLElement | null>, opts: { initialFocus?: string } = {}) {
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  useEffect(() => {
    if (!open) return
    const node = ref.current
    const me = {}
    const previous = document.activeElement as HTMLElement | null
    if (stack.length === 0) origin = previous
    stack.push(me)
    if (!lock) {
      const scrollbar = window.innerWidth - document.documentElement.clientWidth
      lock = { overflow: document.body.style.overflow, padding: document.body.style.paddingRight }
      document.body.style.overflow = 'hidden'
      if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`
    }

    queueMicrotask(() => {
      const target = (opts.initialFocus ? node?.querySelector<HTMLElement>(opts.initialFocus) : null) ?? node?.querySelector<HTMLElement>(FOCUSABLE) ?? node
      target?.focus({ preventScroll: true })
    })

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me) return
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return }
      if (e.key !== 'Tab' || !node) return
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement)
      if (items.length === 0) { e.preventDefault(); return }
      const first = items[0]!, last = items[items.length - 1]!
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      const wasTop = stack[stack.length - 1] === me
      stack.splice(stack.indexOf(me), 1)
      const last = stack.length === 0
      if (last && lock) {
        document.body.style.overflow = lock.overflow
        document.body.style.paddingRight = lock.padding
        lock = null
      }
      // Fermé sous un autre dialogue (Ctrl+J sous une fiche) : le focus reste dans celui qui est au-dessus.
      // Le déclencheur a pu disparaître entre-temps : le dernier dialogue fermé rend alors le focus à celui du premier ouvert.
      if (wasTop) (previous?.isConnected ? previous : last ? origin : null)?.focus?.({ preventScroll: true })
      if (last) origin = null
    }
  }, [open, ref, opts.initialFocus])
}
