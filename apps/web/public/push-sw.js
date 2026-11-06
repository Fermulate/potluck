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

  event.waitUntil(openApp(href))
})

/**
 * Brings the app to `href`: reuses an open tab this worker controls (only those can be
 * navigated), otherwise opens a new window. A navigate that fails still ends in a window.
 */
async function openApp(href) {
  const controlled = await self.clients.matchAll({ type: 'window' })
  const client = controlled.find((c) => new URL(c.url).origin === self.location.origin)
  if (client && 'navigate' in client) {
    try {
      const focused = await client.focus()
      const navigated = await (focused || client).navigate(href)
      if (navigated) return navigated
    } catch {
      // Fall through to a fresh window.
    }
  }
  return self.clients.openWindow(href)
}
