import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Film, LifeBuoy } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n'
import { api, call } from '../lib/api'
import { notificationText } from '../lib/notifications'
import { usePopover } from '../hooks/usePopover'
import { keys } from '../state/queries'
import { useUI } from '../state/ui'

export function NotificationBell() {
  const i18n = useI18n()
  const { t, ago } = i18n
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { openSupport } = useUI()
  const pop = usePopover()
  const list = useQuery({ queryKey: keys.notifications, queryFn: () => call(api.GET('/api/notifications')), refetchInterval: 120_000 })
  const read = useMutation({
    mutationFn: (ids: string[] | null) => call(api.POST('/api/notifications/read', { body: { ids } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  })
  const unread = list.data?.unread ?? 0

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
            {unread > 0 && <button className="link" onClick={() => read.mutate(null)}>{t('notif.markAll')}</button>}
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
                    else if (n.link) navigate(n.link)
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
