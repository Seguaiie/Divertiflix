import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '../i18n'
import { api, call, type Card } from '../lib/api'
import { useDebounced } from '../hooks/useDebounced'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { keys, useWatchlist } from '../state/queries'
import { useUI } from '../state/ui'
import { PosterCard } from '../components/PosterCard'
import { GridSkeleton } from '../components/Skeletons'
import './BrowsePage.css'

const SORTS = ['name', 'recent', 'rating', 'year'] as const

/** Catalogue filtrable (films ou livres audio). Tout l'état est dans l'URL : une recherche se partage et survit au rechargement. */
export function BrowsePage({ kind }: { kind: 'Movie' | 'Audiobook' }) {
  const { t, genre, plural } = useI18n()
  const { openRequest } = useUI()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const activeGenre = params.get('genre') ?? ''
  const sort = (SORTS as readonly string[]).includes(params.get('sort') ?? '') ? params.get('sort')! : 'name'
  const onlyAvailable = params.get('dispo') === '1'
  const dq = useDebounced(q.trim(), 250)
  const isBook = kind === 'Audiobook'
  useDocumentTitle(isBook ? t('nav.audiobooks') : t('nav.films'))

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setParams(next, { replace: true })
  }

  const genres = useQuery({ queryKey: keys.genres(kind), queryFn: () => call(api.GET('/api/titles/genres', { params: { query: { kind } } })), staleTime: 5 * 60_000 })
  const list = useInfiniteQuery({
    queryKey: ['browse', kind, dq, activeGenre, sort, onlyAvailable],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => call(api.GET('/api/titles', { params: { query: { kind, q: dq || undefined, genre: activeGenre || undefined, sort, available: onlyAvailable || undefined, page: pageParam, pageSize: 24 } } })),
    getNextPageParam: last => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    placeholderData: prev => prev,
  })
  const watchlist = useWatchlist()
  const inList = useMemo(() => new Set(watchlist.data?.map(c => c.title.id)), [watchlist.data])
  const items = list.data?.pages.flatMap(p => p.items) ?? []
  const total = list.data?.pages[0]?.total ?? 0
  const cards: Card[] = items.map(title => ({ title, progress: null, inWatchlist: inList.has(title.id), myRating: 0, reason: null, match: 0 }))

  // Défilement infini : une sentinelle déclenche la page suivante, avec un bouton en secours (clavier, mouvement réduit).
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || !list.hasNextPage) return
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting && !list.isFetchingNextPage) void list.fetchNextPage() }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [list.hasNextPage, list.isFetchingNextPage, list])

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">{isBook ? t('browse.booksEyebrow') : t('browse.filmsEyebrow')}</p>
        <h1 className="serif">{isBook ? t('nav.audiobooks') : t('nav.films')}</h1>
        <p>{isBook ? t('browse.booksHelp') : t('browse.filmsHelp')}</p>
      </header>

      <div className="bf" role="search">
        <div className="bf-search">
          <Search aria-hidden />
          <label className="visually-hidden" htmlFor="bf-q">{t('browse.search')}</label>
          <input id="bf-q" className="input" type="search" value={q} onChange={e => set({ q: e.target.value || null })} placeholder={t('browse.search')} autoComplete="off" />
          {q && <button className="icon-btn plain sm" onClick={() => set({ q: null })} aria-label={t('common.clear')}><X /></button>}
        </div>
        <label className="bf-sort"><span className="visually-hidden">{t('browse.sort')}</span>
          <select className="select" value={sort} onChange={e => set({ sort: e.target.value === 'name' ? null : e.target.value })}>
            {SORTS.map(s => <option key={s} value={s}>{t(`browse.sort.${s}` as never)}</option>)}
          </select></label>
        <label className="bf-toggle">
          <input type="checkbox" role="switch" checked={onlyAvailable} onChange={e => set({ dispo: e.target.checked ? '1' : null })} />
          <span className="bf-switch" aria-hidden /><span>{t('browse.onlyAvailable')}</span>
        </label>
      </div>

      {genres.data && genres.data.length > 0 && (
        <div className="bf-genres" role="group" aria-label={t('browse.genres')}>
          <button className="chip" aria-pressed={!activeGenre} onClick={() => set({ genre: null })}>{t('browse.allGenres')}</button>
          {genres.data.map(g => <button key={g.genre} className="chip" aria-pressed={activeGenre === g.genre} onClick={() => set({ genre: activeGenre === g.genre ? null : g.genre })}>{genre(g.genre)} <span className="count">{g.count}</span></button>)}
        </div>
      )}

      <p className="bf-count tnum" role="status" aria-live="polite">{list.isSuccess ? plural('browse.count', total) : ''}</p>

      {list.isPending && <GridSkeleton />}
      {list.isError && <div className="empty"><h2>{t('home.error')}</h2><button className="btn btn-primary" onClick={() => void list.refetch()}>{t('common.retry')}</button></div>}
      {list.isSuccess && cards.length === 0 && (
        <div className="empty">
          <h2>{q ? t('browse.noResultsFor', { q }) : t('browse.noResults')}</h2>
          <p>{t('browse.noResultsHelp')}</p>
          <button className="btn btn-accent" onClick={() => openRequest(q)}>{q ? t('browse.requestQ', { q }) : t('menu.request')}</button>
        </div>
      )}
      {cards.length > 0 && <div className="grid">{cards.map(c => <PosterCard key={c.title.id} card={c} rated={false} />)}</div>}
      <div ref={sentinel} style={{ height: 1 }} />
      {list.hasNextPage && <div style={{ display: 'grid', placeItems: 'center', marginTop: 32 }}><button className="btn btn-glass" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>{list.isFetchingNextPage ? <span className="spinner" /> : null}{t('browse.more')}</button></div>}
    </div>
  )
}
