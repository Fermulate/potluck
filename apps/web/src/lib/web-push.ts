import { deletePushToken } from '@potluck/api'
import { supabase } from './supabase'

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** The active service worker registration, or null if none shows up quickly (dev, old browsers). */
export async function pushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null
  const existing = await navigator.serviceWorker.getRegistration()
  if (existing) return existing
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 3000)),
  ])
}

/** This browser's push subscription, if it has one. */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  const reg = await pushRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

/**
 * Drops this browser's push registration for `userId`: the `push_tokens` row first, then the
 * browser subscription, so a later account on the same device never receives their notifications.
 */
export async function forgetPushSubscription(userId: string): Promise<void> {
  const sub = await currentPushSubscription()
  if (!sub) return
  try {
    await deletePushToken(supabase, userId, sub.endpoint)
  } finally {
    await sub.unsubscribe()
  }
}
