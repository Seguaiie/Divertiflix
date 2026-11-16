import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, BellRing, Film, LifeBuoy } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n'
import { api, call } from '../lib/api'
import { notificationText } from '../lib/notifications'
import { usePopover } from '../hooks/usePopover'
import { usePush } from '../hooks/usePush'
import { keys } from '../state/queries'
import { useToast } from '../state/toast'
import { useUI } from '../state/ui'

export function NotificationBell() {
  const i18n = useI18n()
  const { t, ago } = i18n
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { openSupport } = useUI()
  const toast = useToast()
  const pop = usePopover()
  const push = usePush()
  const list = useQuery({ queryKey: keys.notifications, queryFn: () => call(api.GET('/api/notifications')), refetchInterval: 120_000 })
  const read = useMutation({
    mutationFn: (ids: string[] | null) => call(api.POST('/api/notifications/read', { body: { ids } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  })
  const unread = list.data?.unread ?? 0
  const togglePush = () => void (push.subscribed ? push.unsubscribe() : push.subscribe().then(ok => { if (!ok) toast.push({ kind: 'error', text: t('notif.pushError') }) }))

  return (
    <div className="popover-root" ref={pop.ref}>
      <button className="icon-btn plain" data-popover-trigger aria-expanded={pop.open} aria-haspopup="dialog"
        aria-label={unread ? t('notif.bellUnread', { n: unread }) : t('notif.bell')} onClick={() => pop.setOpen(!pop.open)}>
        <Bell />
        {unread > 0 && <span className="bell-count tnum" aria-hidden>{unread > 9 ? '9+' : unread}</span>}
      </button>
      {pop.open && (
        <div className="popover glass-panel notif" role="dialog" aria-label={t('notif.title')}>
          <header>
            <h2 className="display">{t('notif.title')}</h2>
            <div className="row-flex">
              {unread > 0 && <button className="link" onClick={() => read.mutate(null)}>{t('notif.markAll')}</button>}
              {push.supported && (
                <button className="icon-btn plain" disabled={push.busy} aria-pressed={push.subscribed}
                  aria-label={push.subscribed ? t('notif.disablePush') : t('notif.enablePush')} title={push.subscribed ? t('notif.disablePush') : t('notif.enablePush')}
                  onClick={togglePush}>
                  {push.subscribed ? <BellRing /> : <BellOff />}
                </button>
              )}
            </div>
          </header>
          {list.data && list.data.items.length === 0 && <p className="notif-empty">{t('notif.empty')}</p>}
          <ul>
            {list.data?.items.map(n => {
              const { title, text } = notificationText(n, i18n)
              const Icon = n.kind.startsWith('ticket') ? LifeBuoy : Film
              return (
                <li key={n.id}>
                  <button className="notif-item" data-unread={!n.read} onClick={() => {
                    if (!n.read) read.mutate([n.id])
                    pop.close()
                    if (n.link?.startsWith('/?aide=')) openSupport(n.link.split('=')[1])
                    // Lien vers une application de la maison (ex. Jellyfin pour une demande disponible) : nouvel onglet, sans transmettre la page.
                    else if (n.link?.startsWith('https://')) window.open(n.link, '_blank', 'noopener,noreferrer')
                    else if (n.link?.startsWith('/')) navigate(n.link)
                  }}>
                    <Icon aria-hidden />
                    <span className="notif-text"><strong>{title}</strong><span>{text}</span></span>
                    <time className="tnum" dateTime={n.createdAt}>{ago(n.createdAt)}</time>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
