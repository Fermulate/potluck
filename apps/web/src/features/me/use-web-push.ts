import { deletePushToken, savePushToken, type Json } from '@potluck/api'
import { useCallback, useEffect, useState } from 'react'
import { useUserId } from '@/lib/auth'
import { useAppConfig } from '@/lib/queries'
import { supabase } from '@/lib/supabase'

export type PushState = 'loading' | 'unsupported' | 'not-configured' | 'blocked' | 'off' | 'on'

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** The active service worker registration, or null if none shows up quickly (dev, old browsers). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null
  const existing = await navigator.serviceWorker.getRegistration()
  if (existing) return existing
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 3000)),
  ])
}

/**
 * Web push for this device. The subscription lives in the browser; its endpoint is stored in
 * `push_tokens` so the `notify` edge function can reach it.
 */
export function useWebPush() {
  const userId = useUserId()
  const { data: config, isPending: configPending } = useAppConfig()
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  const flagOff = config !== undefined && config.web_push === false
  const [state, setState] = useState<PushState>('loading')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const settle = (next: PushState) => {
      if (!cancelled) setState(next)
    }
    if (!supported()) settle('unsupported')
    else if (!vapidKey || flagOff) settle('not-configured')
    else if (Notification.permission === 'denied') settle('blocked')
    else if (!configPending) {
      void registration()
        .then((reg) => (reg ? reg.pushManager.getSubscription() : null))
        .then((sub) => settle(sub ? 'on' : 'off'))
        .catch(() => settle('off'))
    }
    return () => {
      cancelled = true
    }
  }, [vapidKey, flagOff, configPending])

  const enable = useCallback(async () => {
    if (!vapidKey) return false
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'off')
        return false
      }
      const reg = await registration()
      if (!reg) throw new Error('no_service_worker')
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(vapidKey),
        }))
      await savePushToken(supabase, userId, {
        token: sub.endpoint,
        platform: 'web',
        subscription: sub.toJSON() as Json,
      })
      setState('on')
      return true
    } finally {
      setBusy(false)
    }
  }, [userId, vapidKey])

  const disable = useCallback(async () => {
    setBusy(true)
    try {
      const reg = await registration()
      const sub = reg ? await reg.pushManager.getSubscription() : null
      if (sub) {
        await deletePushToken(supabase, userId, sub.endpoint)
        await sub.unsubscribe()
      }
      setState('off')
    } finally {
      setBusy(false)
    }
  }, [userId])

  return { state, busy, enable, disable }
}
