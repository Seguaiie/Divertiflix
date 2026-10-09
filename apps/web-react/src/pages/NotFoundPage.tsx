import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export function NotFoundPage() {
  const { t } = useI18n()
  useDocumentTitle(t('notFound.title'))
  return (
    <div className="page"><div className="empty">
      <p className="eyebrow">404</p>
      <h2>{t('notFound.title')}</h2><p>{t('notFound.help')}</p>
      <Link className="btn btn-primary" to="/">{t('nav.home')}</Link>
    </div></div>
  )
}
