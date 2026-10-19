/* global self */
/* Web push for the Potluck service worker. Imported by the generated worker (see vite.config.ts).
 * The `notify` edge function sends JSON: { title, body, url, id, type }. */

self.addEventListener('push', (event) => {
  let payload
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }
  const title = payload.title || 'Potluck'
  const options = {
    body: payload.body || '',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload.id || payload.type || undefined,
    data: { url: payload.url || '/notifications', id: payload.id },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/notifications', self.location.origin)
  // Only ever open pages on this origin.
  const href =
    target.origin === self.location.origin ? target.href : self.location.origin + '/notifications'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin !== self.location.origin) continue
        await client.focus()
        if ('navigate' in client) return client.navigate(href)
        return undefined
      }
      return self.clients.openWindow(href)
    }),
  )
})
