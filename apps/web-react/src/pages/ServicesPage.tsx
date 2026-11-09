import type { CSSProperties } from 'react'
import { BellRing, BookOpen, ExternalLink, Film, Images, Inbox, KeyRound, LayoutDashboard, Server, ShieldAlert, type LucideIcon } from 'lucide-react'
import { useI18n, type Key } from '../i18n'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useHomeServices } from '../state/queries'
import type { ServiceProbe } from '../lib/api'
import './ServicesPage.css'

/** Icône et couleur de marque (éclaircie pour le fond sombre) de chaque application. */
const LOOK: Record<string, { icon: LucideIcon; color: string }> = {
  jellyfin: { icon: Film, color: '#9b6bff' },
  jellyseerr: { icon: Inbox, color: '#818cf8' },
  immich: { icon: Images, color: '#ff6b5e' },
  vaultwarden: { icon: KeyRound, color: '#4d8dff' },
  bookstack: { icon: BookOpen, color: '#3fa7e8' },
  ntfy: { icon: BellRing, color: '#3fc29b' },
  homarr: { icon: LayoutDashboard, color: '#ff6b6b' },
}
const look = (key: string) => LOOK[key] ?? { icon: Server, color: 'var(--accent-hi)' }

/** Onglet « Services » : les applications auto-hébergées de la maison, avec leur état mesuré par l'API. */
export function ServicesPage() {
  const { t } = useI18n()
  const services = useHomeServices()
  useDocumentTitle(t('nav.services'))

  const list = services.data ?? []
  const troubled = list.filter(s => s.state === 'down' || s.state === 'degraded').length
  const untrusted = list.some(s => s.tls === 'untrusted')

  return (
    <div className="page services">
      <header className="page-head svc-hero">
        <p className="eyebrow">{t('svc.eyebrow')}</p>
        <h1 className="display">{t('nav.services')}</h1>
        <p>{t('svc.lead')}</p>
        {services.data && (
          <p className={troubled ? 'svc-summary is-warn' : 'svc-summary'} role="status">
            <span className="svc-dot" aria-hidden />
            {troubled ? t('svc.someDown', { n: troubled }) : t('svc.allUp')}
          </p>
        )}
      </header>

      {services.isPending && <div className="svc-grid" aria-busy="true">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="svc-skeleton" />)}</div>}
      {services.isError && !services.data && (
        <div className="empty" role="alert"><h2>{t('svc.error')}</h2><p>{t('svc.errorHelp')}</p>
          <button className="btn btn-primary" onClick={() => void services.refetch()}>{t('common.retry')}</button></div>
      )}

      {list.length > 0 && <ul className="svc-grid">{list.map(s => <li key={s.key}><Tile service={s} /></li>)}</ul>}

      {untrusted && <p className="svc-note"><ShieldAlert aria-hidden />{t('svc.caNote')}</p>}
    </div>
  )
}

function Tile({ service: s }: { service: ServiceProbe }) {
  const { t, ago } = useI18n()
  const { icon: Icon, color } = look(s.key)
  const state = s.state === 'up' || s.state === 'degraded' || s.state === 'down' ? s.state : 'unknown'
  if (!s.url || !/^https:\/\//.test(s.url)) return null
  return (
    <a className={`svc-tile is-${state}`} href={s.url} target="_blank" rel="noopener noreferrer" style={{ '--svc': color } as CSSProperties}
      aria-label={`${t('svc.open', { name: s.name })} — ${t(`svc.${state}` as Key)}`}>
      <span className="svc-icon" aria-hidden><Icon /></span>
      <span className="svc-body">
        <span className="svc-name">{s.name}<ExternalLink aria-hidden /></span>
        <span className="svc-desc">{t(`svc.d.${s.key}` as Key)}</span>
        <span className="svc-state">
          <span className="svc-dot" aria-hidden />
          <b>{t(`svc.${state}` as Key)}</b>
          {state === 'up' && s.latencyMs != null && <span className="tnum">· {t('svc.ms', { n: s.latencyMs })}</span>}
          {state !== 'up' && s.since && <span>· {t('svc.since', { time: ago(s.since) })}</span>}
        </span>
        {s.error && state !== 'up' && <span className="svc-error">{s.error}</span>}
      </span>
    </a>
  )
}
