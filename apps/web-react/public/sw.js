// Notifications infonuagiques (Web Push) : affiche la notification reçue, ouvre ou ramène au premier plan l'onglet du portail au clic.
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* corps non JSON : notification générique */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Divertiflix', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { link: data.link || '/' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const link = event.notification.data?.link || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus().then(() => c.navigate ? c.navigate(link) : undefined)
      return self.clients.openWindow(link)
    }),
  )
})
