import { useI18n } from '../i18n'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useClearProgress, useHistory } from '../state/queries'
import { PosterCard } from '../components/PosterCard'
import { GridSkeleton } from '../components/Skeletons'

export function HistoryPage() {
  const { t, plural } = useI18n()
  const history = useHistory()
  const clear = useClearProgress()
  useDocumentTitle(t('nav.history'))
  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">{t('history.eyebrow')}</p>
        <h1 className="display">{t('nav.history')}</h1>
        {history.data && history.data.length > 0 && <p className="tnum">{plural('browse.count', history.data.length)}</p>}
      </header>
      {history.isPending && <GridSkeleton n={6} />}
      {history.isError && <div className="empty"><h2>{t('home.error')}</h2><button className="btn btn-primary" onClick={() => void history.refetch()}>{t('common.retry')}</button></div>}
      {history.data?.length === 0 && <div className="empty"><h2>{t('history.empty')}</h2><p>{t('history.emptyHelp')}</p></div>}
      {history.data && history.data.length > 0 && (
        <div className="grid">{history.data.map(c => <PosterCard key={c.title.id} card={c} onRemove={() => clear.mutate(c.title.id)} />)}</div>
      )}
    </div>
  )
}
