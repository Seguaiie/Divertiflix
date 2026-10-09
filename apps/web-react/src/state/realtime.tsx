import { useEffect, type ReactNode } from 'react'
import type * as SignalR from '@microsoft/signalr'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n'
import { freshAccessToken, type S } from '../lib/api'
import { notificationText } from '../lib/notifications'
import { useAuth } from './auth'
import { keys } from './queries'
import { useToast } from './toast'

/**
 * Connexion temps réel (SignalR) tant qu'un utilisateur est connecté : ses notifications arrivent sans rechargement,
 * et un nouveau titre au catalogue rafraîchit l'accueil. Le jeton est renouvelé d'avance à chaque (re)connexion.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const i18n = useI18n()
  const navigate = useNavigate()

  useEffect(() => {
    if (!user) return
    let stopped = false
    let retry: ReturnType<typeof setTimeout> | undefined
    let conn: SignalR.HubConnection | undefined

    // La bibliothèque SignalR (~80 Ko) n'est chargée qu'une fois la session ouverte, hors du chemin critique de la page de connexion.
    void import('@microsoft/signalr').then(signalR => {
      if (stopped) return
      conn = new signalR.HubConnectionBuilder()
        .withUrl('/api/hubs/notifications', { accessTokenFactory: freshAccessToken })
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(signalR.LogLevel.None)
        .build()
      wire(conn)
    })

    function wire(conn: SignalR.HubConnection) {
    conn.on('notification', (n: S['NotificationDto']) => {
      void qc.invalidateQueries({ queryKey: keys.notifications })
      // Ce que la notification annonce doit déjà être à jour à l'écran : fil de billet ouvert, liste de demandes, accueil.
      if (n.kind.startsWith('ticket')) { void qc.invalidateQueries({ queryKey: keys.tickets }); void qc.invalidateQueries({ queryKey: ['ticket'] }) }
      else if (n.kind.startsWith('request')) {
        void qc.invalidateQueries({ queryKey: ['requests'] })
        if (n.kind === 'request.available') { void qc.invalidateQueries({ queryKey: ['home'] }); void qc.invalidateQueries({ queryKey: ['detail'] }) }
      }
      const { title, text } = notificationText(n, i18n)
      toast.push({ kind: 'info', title, text, action: n.link ? { label: i18n.t('notif.open'), run: () => navigate(n.link!) } : undefined })
    })
    conn.on('titleAdded', (t: S['TitleDto']) => {
      void qc.invalidateQueries({ queryKey: ['home'] })
      toast.push({ kind: 'info', title: i18n.t('toast.newTitle'), text: t.name, action: { label: i18n.t('notif.open'), run: () => navigate(`/titres/${t.id}`) } })
    })

    const start = () => conn.start().catch(() => { if (!stopped) retry = setTimeout(start, 30_000) })
    // Après les tentatives automatiques épuisées, on repart avec un jeton frais.
    conn.onclose(() => { if (!stopped) retry = setTimeout(start, 30_000) })
    void start()
    }
    return () => { stopped = true; clearTimeout(retry); void conn?.stop() }
    // i18n est recréé à chaque changement de langue : on se reconnecte alors, ce qui est sans conséquence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  return <>{children}</>
}
