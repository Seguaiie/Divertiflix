import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api'
import { TitleCard } from '../components/TitleCard'
import { useDebounced } from '../useDebounced'

export function BrowsePage() {
  const [q, setQ] = useState('')
  const [genre, setGenre] = useState('')
  const [page, setPage] = useState(1)
  const dq = useDebounced(q, 300)

  const titles = useQuery({
    queryKey: ['titles', dq, genre, page],
    queryFn: async () => {
      const { data } = await api.GET('/api/titles', { params: { query: { q: dq || undefined, genre: genre || undefined, page, pageSize: 12 } } })
      return data
    },
    placeholderData: keepPreviousData,
  })
  // Les genres viennent d'une première page non filtrée.
  const all = useQuery({
    queryKey: ['genres'],
    queryFn: async () => (await api.GET('/api/titles', { params: { query: { pageSize: 100 } } })).data?.items ?? [],
    staleTime: 5 * 60_000,
  })
  const genres = [...new Set(all.data?.map(t => t.genre))].sort()
  const pages = titles.data ? Math.max(1, Math.ceil(titles.data.total / titles.data.pageSize)) : 1

  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder="Rechercher un titre…" value={q} onChange={e => { setQ(e.target.value); setPage(1) }} />
        <select value={genre} onChange={e => { setGenre(e.target.value); setPage(1) }} aria-label="Genre">
          <option value="">Tous les genres</option>
          {genres.map(g => <option key={g}>{g}</option>)}
        </select>
      </div>
      {titles.isLoading && <p>Chargement…</p>}
      {titles.data?.items.length === 0 && <p>Aucun résultat.</p>}
      <div className="grid">{titles.data?.items.map(t => <TitleCard key={t.id} title={t} />)}</div>
      {pages > 1 && (
        <div className="pager">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>←</button>
          <span>{page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)}>→</button>
        </div>
      )}
    </>
  )
}
