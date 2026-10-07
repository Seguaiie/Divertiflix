import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
// hls.js pèse lourd : chargé seulement quand on ouvre un titre.
const Player = lazy(() => import('../components/Player').then(m => ({ default: m.Player })))

export function TitlePage() {
  const { id = '' } = useParams()
  const { profileId } = useAuth()
  const qc = useQueryClient()

  const title = useQuery({ queryKey: ['title', id], queryFn: async () => (await api.GET('/api/titles/{id}', { params: { path: { id } } })).data })
  const watchlist = useQuery({
    queryKey: ['watchlist', profileId],
    enabled: !!profileId,
    queryFn: async () => (await api.GET('/api/profiles/{id}/watchlist', { params: { path: { id: profileId! } } })).data ?? [],
  })
  const inList = watchlist.data?.some(t => t.id === id) ?? false

  const toggle = useMutation({
    mutationFn: () => {
      const params = { params: { path: { id: profileId!, titleId: id } } }
      return inList ? api.DELETE('/api/profiles/{id}/watchlist/{titleId}', params) : api.PUT('/api/profiles/{id}/watchlist/{titleId}', params)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlist', profileId] }),
  })

  if (title.isLoading) return <p>Chargement…</p>
  const t = title.data
  if (!t) return <p>Titre introuvable.</p>

  return (
    <article className="detail">
      {t.streamUrl ? <Suspense fallback={<div className="player empty">Chargement du lecteur…</div>}><Player src={t.streamUrl} poster={t.posterUrl} /></Suspense> : <div className="player empty">Vidéo non disponible</div>}
      <h1>{t.name}</h1>
      <p className="meta">{t.year} · {t.kind === 'Movie' ? 'Film' : 'Série'} · {t.genre} · {t.durationMinutes} min</p>
      <p>{t.synopsis}</p>
      <button onClick={() => toggle.mutate()} disabled={toggle.isPending}>
        {inList ? '✓ Dans ma liste' : '+ Ma liste'}
      </button>
    </article>
  )
}
