import { useQuery } from '@tanstack/react-query'
import { BookOpen, Clapperboard, Home, LifeBuoy, ListVideo, LogOut, PlusCircle, Search, Settings2, Sparkles, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n'
import { api, call, type Title } from '../lib/api'
import { useDebounced } from '../hooks/useDebounced'
import { useDialog } from '../hooks/useDialog'
import { useAuth } from '../state/auth'
import { useUI } from '../state/ui'
import { Artwork } from './Art'
import './CommandPalette.css'

interface Item { id: string; kind: 'action' | 'title' | 'ask'; label: string; hint?: string; icon?: typeof Home; title?: Title; run(): void }
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Palette de commandes (Ctrl/Cmd+K ou « / ») : recherche de titres et actions, entièrement au clavier (combobox ARIA). */
export function CommandPalette() {
  const { t, genre } = useI18n()
  const ui = useUI()
  const { selectProfile, logout, isStaff } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const close = () => ui.setPaletteOpen(false)
  useDialog(ui.paletteOpen, close, ref, { initialFocus: 'input' })
  const dq = useDebounced(q.trim(), 180)

  const results = useQuery({
    queryKey: ['palette', dq],
    enabled: ui.paletteOpen && dq.length >= 2,
    queryFn: () => call(api.GET('/api/titles', { params: { query: { q: dq, pageSize: 7, sort: 'name' } } })),
    placeholderData: prev => prev,
  })

  useEffect(() => { if (!ui.paletteOpen) { setQ(''); setActive(0) } }, [ui.paletteOpen])
  useEffect(() => setActive(0), [dq, results.data])

  const go = (path: string) => () => { close(); navigate(path) }
  const actions = useMemo<Item[]>(() => [
    { id: 'home', kind: 'action', label: t('nav.home'), icon: Home, run: go('/') },
    { id: 'films', kind: 'action', label: t('nav.films'), icon: Clapperboard, run: go('/films') },
    { id: 'books', kind: 'action', label: t('nav.audiobooks'), icon: BookOpen, run: go('/livres-audio') },
    { id: 'list', kind: 'action', label: t('nav.myList'), icon: ListVideo, run: go('/ma-liste') },
    { id: 'assistant', kind: 'action', label: t('nav.assistant'), icon: Sparkles, run: () => { close(); ui.setAssistantOpen(true) } },
    { id: 'request', kind: 'action', label: t('menu.request'), icon: PlusCircle, run: () => { close(); ui.openRequest(q.trim()) } },
    { id: 'help', kind: 'action', label: t('menu.help'), icon: LifeBuoy, run: () => { close(); ui.openSupport() } },
    { id: 'profile', kind: 'action', label: t('menu.switchProfile'), icon: UserRound, run: () => { close(); selectProfile(null); navigate('/profils') } },
    ...(isStaff ? [{ id: 'admin', kind: 'action' as const, label: t('menu.backoffice'), icon: Settings2, run: () => { window.location.href = '/admin/' } }] : []),
    { id: 'logout', kind: 'action', label: t('menu.logout'), icon: LogOut, run: () => { close(); logout(); navigate('/connexion') } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, isStaff, q])

  const items = useMemo<Item[]>(() => {
    const needle = norm(q.trim())
    const titles: Item[] = (results.data?.items ?? []).map(title => ({
      id: title.id, kind: 'title', label: title.name, title,
      hint: [title.kind === 'Audiobook' ? title.author : String(title.year), genre(title.genre)].filter(Boolean).join(' · '),
      run: () => { close(); navigate(`/titres/${title.id}`, { state: { background: location } }) },
    }))
    const shown = needle ? actions.filter(a => norm(a.label).includes(needle)) : actions
    const ask: Item[] = needle.length >= 4 ? [{ id: 'ask', kind: 'ask', label: t('palette.ask', { q: q.trim() }), icon: Sparkles, run: () => { close(); ui.askAssistant(q.trim()) } }] : []
    return needle ? [...titles, ...ask, ...shown] : shown
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, results.data, actions, t])

  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active])

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(items.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); items[active]?.run() }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(items.length - 1) }
  }

  if (!ui.paletteOpen) return null
  const optionId = (i: number) => `pal-opt-${i}`

  return (
    <div className="overlay pal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div className="sheet pal" role="dialog" aria-modal="true" aria-label={t('palette.title')} ref={ref}>
        <div className="pal-input">
          <Search aria-hidden />
          <input role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant={items.length ? optionId(active) : undefined} aria-autocomplete="list"
            value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder={t('palette.placeholder')} aria-label={t('palette.title')} autoComplete="off" spellCheck={false} />
          <kbd className="kbd">Esc</kbd>
        </div>
        <ul id="pal-list" className="pal-list" role="listbox" ref={listRef}>
          {items.map((it, i) => (
            <li key={`${it.kind}-${it.id}`} id={optionId(i)} role="option" aria-selected={i === active} data-kind={it.kind}
              onMouseMove={() => setActive(i)} onClick={it.run}>
              {it.title
                ? <span className="pal-thumb"><Artwork src={it.title.posterUrl} seed={it.title.id} genre={it.title.genre} ratio={it.title.kind === 'Audiobook' ? 'square' : 'poster'} /></span>
                : it.icon && <span className="pal-icon"><it.icon aria-hidden /></span>}
              <span className="pal-label">{it.label}</span>
              {it.hint && <span className="pal-hint">{it.hint}</span>}
              {!it.hint && it.kind !== 'title' && <span className="pal-hint">{it.kind === 'ask' ? t('nav.assistantShort') : t('palette.action')}</span>}
            </li>
          ))}
          {items.length === 0 && <li className="pal-empty" role="presentation">{results.isFetching ? t('common.loading') : t('palette.empty', { q })}</li>}
        </ul>
        <div className="pal-foot"><span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> {t('palette.navigate')}</span><span><kbd className="kbd">↵</kbd> {t('palette.open')}</span></div>
      </div>
    </div>
  )
}
