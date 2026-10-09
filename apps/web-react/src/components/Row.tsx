import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { useReducedMotion } from '../hooks/useMedia'
import './Row.css'

/**
 * Rangée horizontale : défilement natif (inertie, accroche, tactile) avec flèches au survol et navigation au clavier.
 * Une rangée qui plante ne casse pas la page : voir RowBoundary.
 */
export function Row({ title, eyebrow, action, children, label }: { title: string; eyebrow?: string; action?: ReactNode; children: ReactNode; label?: string }) {
  const { t } = useI18n()
  const reduced = useReducedMotion()
  const scroller = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ start: true, end: true })

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 })
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [measure, children])

  const scrollBy = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.85, behavior: reduced ? 'auto' : 'smooth' })

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const links = [...e.currentTarget.querySelectorAll<HTMLElement>('.card-link')]
    const i = links.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    const next = links[i + (e.key === 'ArrowRight' ? 1 : -1)]
    if (next) { e.preventDefault(); next.focus(); next.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }) }
  }

  return (
    <section className="row" aria-label={label ?? title}>
      <header className="row-head">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 className="display">{title}</h2>
        </div>
        {action}
      </header>
      <div className="row-frame">
        <button className="row-arrow prev" onClick={() => scrollBy(-1)} disabled={edge.start} aria-label={t('row.prev')} tabIndex={edge.start ? -1 : 0}><ChevronLeft /></button>
        <div className="row-scroller" ref={scroller} onScroll={measure} onKeyDown={onKeyDown}>
          <div className="row-list">{children}</div>
        </div>
        <button className="row-arrow next" onClick={() => scrollBy(1)} disabled={edge.end} aria-label={t('row.next')} tabIndex={edge.end ? -1 : 0}><ChevronRight /></button>
      </div>
    </section>
  )
}
