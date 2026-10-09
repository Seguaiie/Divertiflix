import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useI18n } from '../i18n'
import { api, ApiError, call } from '../lib/api'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useAuth } from '../state/auth'
import { useDock } from '../state/dock'
import { keys, useDetail } from '../state/queries'
import { Player } from '../components/Player'

/** Page de lecture : charge la fiche et l'URL de lecture (signée, durée courte), puis confie la suite au lecteur. */
export function WatchPage() {
  const { id = '' } = useParams()
  const { t } = useI18n()
  const { profileId } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const dock = useDock()
  const detail = useDetail(id)
  const playback = useQuery({
    queryKey: ['playback', profileId, id],
    enabled: !!profileId,
    gcTime: 0, staleTime: 0, refetchOnWindowFocus: false, retry: false,
    queryFn: () => call(api.GET('/api/titles/{id}/playback', { params: { path: { id }, query: { profileId: profileId ?? undefined } } })),
  })
  const title = detail.data?.card.title
  useDocumentTitle(title?.name)

  const back = useCallback(() => (location.key !== 'default' ? navigate(-1) : navigate('/', { replace: true })), [navigate, location.key])

  // Le « Continuer à regarder » et les recommandations dépendent de ce qu'on vient de regarder.
  useEffect(() => () => {
    void qc.invalidateQueries({ queryKey: keys.home(profileId ?? '') })
    void qc.invalidateQueries({ queryKey: ['detail', profileId] })
  }, [qc, profileId])

  // Un livre audio ouvert par erreur sur la page de lecture vidéo : on le confie au lecteur persistant.
  useEffect(() => {
    if (title && playback.data?.kind === 'Audio') { void dock.play(title); back() }
  }, [title, playback.data?.kind]) // eslint-disable-line react-hooks/exhaustive-deps

  if (detail.isError || playback.isError) {
    const unavailable = playback.error instanceof ApiError && playback.error.status === 409
    return (
      <div className="player" style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="empty"><h2>{unavailable ? t('player.unavailable') : t('player.errorTitle')}</h2><p>{unavailable ? t('player.unavailableHelp') : t('player.errorHelp')}</p>
          <div className="row-flex"><button className="btn btn-primary" onClick={back}>{t('player.back')}</button>{!unavailable && <button className="btn btn-glass" onClick={() => { void playback.refetch(); void detail.refetch() }}>{t('common.retry')}</button>}</div></div>
      </div>
    )
  }
  if (!title || !playback.data || !profileId || playback.data.kind === 'Audio') {
    return <div className="player" style={{ display: 'grid', placeItems: 'center' }} role="status"><span className="spinner" style={{ width: 44, height: 44 }} /><span className="visually-hidden">{t('common.loading')}</span></div>
  }
  return <Player key={playback.data.url} profileId={profileId} title={title} playback={playback.data} similar={detail.data?.similar ?? []} onBack={back} onRetry={() => void playback.refetch()} />
}
