import { RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'
import type { S } from '../lib/api'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useHome } from '../state/queries'
import { useUI } from '../state/ui'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { Hero, HeroSkeleton } from '../components/Hero'
import { PosterCard } from '../components/PosterCard'
import { Row } from '../components/Row'
import { RowSkeleton } from '../components/Skeletons'
import './HomePage.css'

type HomeRow = S['RowDto']

function RequestsRow({ row }: { row: HomeRow }) {
  const { t, ago } = useI18n()
  const { openRequest } = useUI()
  return (
    <Row title={t('row.requests')} eyebrow={t('row.requestsEyebrow')} action={<button className="btn btn-glass btn-sm" onClick={() => openRequest()}>{t('menu.request')}</button>}>
      {row.requests!.map(r => {
        const inner = (
          <>
            <span className="rq-kind eyebrow">{r.kind === 'Audiobook' ? t('title.kindBook') : t('title.kindFilm')}{r.year ? ` · ${r.year}` : ''}</span>
            <strong className="serif">{r.name}</strong>
            <span className="rq-status"><span className={`dot ${r.status === 'Available' ? 'up' : r.status === 'Pending' ? '' : 'degraded'}`} aria-hidden />{t(`request.status.${r.status}` as never)}</span>
            <span className="rq-meta">{r.mine ? t('request.mineBadge') : t('request.community')} · <time dateTime={r.updatedAt}>{ago(r.updatedAt)}</time></span>
          </>
        )
        return r.titleId
          ? <Link key={r.id} to={`/titres/${r.titleId}`} className="rq-card">{inner}</Link>
          : <div key={r.id} className="rq-card">{inner}</div>
      })}
    </Row>
  )
}

function HomeRowView({ row }: { row: HomeRow }) {
  const { t, genre } = useI18n()
  if (row.type === 'requests') return <RequestsRow row={row} />
  const cards = row.items.map(c => <PosterCard key={c.title.id} card={c} showReason={row.type === 'forYou'} />)
  switch (row.type) {
    case 'continue': return <Row title={t('row.continue')}>{cards}</Row>
    case 'watchlist': return <Row title={t('row.watchlist')} action={<Link className="link" to="/ma-liste">{t('row.seeAll')}</Link>}>{cards}</Row>
    case 'forYou': return <Row title={t('row.forYou')} eyebrow={t('row.forYouEyebrow')}>{cards}</Row>
    case 'because': return <Row title={t('row.because', { title: row.seed ?? '' })}>{cards}</Row>
    case 'trending': return <Row title={t('row.trending')} eyebrow={t('row.trendingEyebrow')}>{cards}</Row>
    case 'recent': return <Row title={t('row.recent')}>{cards}</Row>
    case 'genre': return <Row title={genre(row.seed ?? '')}>{cards}</Row>
    case 'audiobooks': return <Row title={t('row.audiobooks')} eyebrow={t('row.audiobooksEyebrow')} action={<Link className="link" to="/livres-audio">{t('row.seeAll')}</Link>}>{cards}</Row>
    default: return null
  }
}

export function HomePage() {
  const { t } = useI18n()
  const home = useHome()
  const { openRequest } = useUI()
  useDocumentTitle(null)

  if (home.isPending) return <><HeroSkeleton /><RowSkeleton /><RowSkeleton /><RowSkeleton /></>
  if (home.isError) {
    return (
      <div className="page"><div className="empty">
        <h2>{t('home.error')}</h2><p>{t('home.errorHelp')}</p>
        <button className="btn btn-primary" onClick={() => void home.refetch()}><RotateCcw aria-hidden />{t('common.retry')}</button>
      </div></div>
    )
  }
  const { hero, rows } = home.data
  if (hero.length === 0 && rows.length === 0) {
    return <div className="page"><div className="empty"><h2>{t('home.empty')}</h2><p>{t('home.emptyHelp')}</p><button className="btn btn-accent" onClick={() => openRequest()}>{t('menu.request')}</button></div></div>
  }

  return (
    <>
      {hero.length > 0 ? <Hero items={hero} /> : <div style={{ height: 'var(--nav-h)' }} />}
      <div className="home-rows">
        {rows.map(r => (
          <ErrorBoundary key={r.id} fallback={retry => (
            <div className="row-error" role="alert"><span>{t('home.rowError')}</span><button className="link" onClick={retry}>{t('common.retry')}</button></div>
          )}>
            <HomeRowView row={r} />
          </ErrorBoundary>
        ))}
      </div>
    </>
  )
}
