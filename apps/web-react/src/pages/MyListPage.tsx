import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useWatchlist } from '../state/queries'
import { PosterCard } from '../components/PosterCard'
import { GridSkeleton } from '../components/Skeletons'

export function MyListPage() {
  const { t, plural } = useI18n()
  const list = useWatchlist()
  useDocumentTitle(t('nav.myList'))
  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">{t('list.eyebrow')}</p>
        <h1 className="serif">{t('nav.myList')}</h1>
        {list.data && list.data.length > 0 && <p className="tnum">{plural('browse.count', list.data.length)}</p>}
      </header>
      {list.isPending && <GridSkeleton n={6} />}
      {list.isError && <div className="empty"><h2>{t('home.error')}</h2><button className="btn btn-primary" onClick={() => void list.refetch()}>{t('common.retry')}</button></div>}
      {list.data?.length === 0 && (
        <div className="empty"><h2>{t('list.empty')}</h2><p>{t('list.emptyHelp')}</p><Link className="btn btn-accent" to="/films">{t('list.discover')}</Link></div>
      )}
      {list.data && list.data.length > 0 && <div className="grid">{list.data.map(c => <PosterCard key={c.title.id} card={c} />)}</div>}
    </div>
  )
}
