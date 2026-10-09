import { useQuery } from '@tanstack/react-query'
import { api, call } from '../lib/api'
import { useI18n } from '../i18n'
import { usePopover } from '../hooks/usePopover'
import { keys } from '../state/queries'
import { useUI } from '../state/ui'
import { Logo } from './Logo'

/** Badge d'état : chaque voyant vient d'une mesure faite par l'API (base de données, liaison capteurs), aucun n'est décoratif. */
function StatusBadge() {
  const { t } = useI18n()
  const pop = usePopover()
  const status = useQuery({ queryKey: keys.status, queryFn: () => call(api.GET('/api/status')), refetchInterval: 60_000, retry: 1 })
  const state = status.isError ? 'down' : (status.data?.state ?? 'unknown')
  const label = status.isError ? t('status.unreachable') : state === 'up' ? t('status.up') : state === 'degraded' ? t('status.degraded') : state === 'down' ? t('status.down') : t('status.checking')

  return (
    <div className="popover-root up" ref={pop.ref}>
      <button className="status-badge" data-popover-trigger aria-expanded={pop.open} aria-haspopup="dialog" onClick={() => pop.setOpen(!pop.open)}>
        <span className={`dot ${state === 'unknown' ? '' : state}`} aria-hidden />{label}
      </button>
      {pop.open && (
        <div className="popover glass-panel status-pop" role="dialog" aria-label={t('status.title')}>
          <h2 className="eyebrow">{t('status.title')}</h2>
          <ul>
            {status.data?.services.map(s => (
              <li key={s.id}>
                <span className={`dot ${s.state}`} aria-hidden />
                <span className="grow">{t(`status.svc.${s.id}` as never)}</span>
                <span className="tnum" style={{ color: 'var(--text-3)' }}>{s.state === 'up' ? (s.latencyMs != null ? `${s.latencyMs} ms` : t('status.ok')) : t('status.offline')}</span>
              </li>
            ))}
          </ul>
          {status.data && <p className="hint">v{status.data.version}</p>}
        </div>
      )}
    </div>
  )
}

export function Footer() {
  const { t } = useI18n()
  const { openSupport, openRequest } = useUI()
  return (
    <footer className="footer">
      <div className="footer-top">
        <Logo />
        <nav className="footer-links" aria-label={t('footer.links')}>
          <button onClick={() => openSupport()}>{t('footer.help')}</button>
          <button onClick={() => openRequest()}>{t('footer.request')}</button>
          <span className="footer-keys">{t('footer.shortcuts')}: <kbd className="kbd">/</kbd> {t('footer.search')} · <kbd className="kbd">Ctrl</kbd><kbd className="kbd">J</kbd> {t('footer.assistant')}</span>
        </nav>
        <StatusBadge />
      </div>
      <p className="footer-note">{t('footer.note')}</p>
    </footer>
  )
}
