import { useEffect, useState } from 'react'
import { api, call } from '../lib/api'

/** Clé publique VAPID (base64url) vers le format binaire attendu par PushManager.subscribe. */
function applicationServerKey(base64url: string): ArrayBuffer {
  const base64 = (base64url + '='.repeat((4 - base64url.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes.buffer
}

/** Abonnement Web Push de cet appareil : notifications reçues même l'onglet fermé. Inactif si le navigateur ou le serveur ne le propose pas. */
export function usePush() {
  const [supported] = useState(() => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supported) return
    void navigator.serviceWorker.register('/sw.js').then(r => r.pushManager.getSubscription()).then(s => setSubscribed(!!s)).catch(() => undefined)
  }, [supported])

  async function subscribe(): Promise<boolean> {
    setBusy(true)
    try {
      const { publicKey } = await call(api.GET('/api/push/public-key'))
      const reg = await navigator.serviceWorker.register('/sw.js')
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) })
      const json = sub.toJSON()
      await call(api.POST('/api/push/subscribe', { body: { endpoint: json.endpoint!, p256dh: json.keys!.p256dh!, auth: json.keys!.auth! } }))
      setSubscribed(true)
      return true
    } catch { return false } finally { setBusy(false) }
  }

  async function unsubscribe(): Promise<void> {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await call(api.DELETE('/api/push/subscribe', { params: { query: { endpoint: sub.endpoint } } })).catch(() => undefined)
        await sub.unsubscribe()
      }
    } finally { setSubscribed(false); setBusy(false) }
  }

  return { supported, subscribed, busy, subscribe, unsubscribe }
}
