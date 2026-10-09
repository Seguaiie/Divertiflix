import type { I18n } from '../i18n'
import type { S } from './api'

/** Texte localisé d'une notification : le serveur envoie un code (kind) et un nom, le client rédige. */
export function notificationText(n: Pick<S['NotificationDto'], 'kind' | 'title' | 'body'>, { t }: Pick<I18n, 't'>): { title: string; text: string } {
  switch (n.kind) {
    case 'request.approved': return { title: t('notif.request.approved'), text: n.title }
    case 'request.downloading': return { title: t('notif.request.downloading'), text: n.title }
    case 'request.available': return { title: t('notif.request.available'), text: n.title }
    case 'request.declined': return { title: t('notif.request.declined'), text: n.body ? `${n.title} : ${n.body}` : n.title }
    case 'ticket.reply': return { title: t('notif.ticket.reply'), text: n.title }
    case 'ticket.resolved': return { title: t('notif.ticket.resolved'), text: n.title }
    default: return { title: n.title, text: n.body ?? '' }
  }
}
