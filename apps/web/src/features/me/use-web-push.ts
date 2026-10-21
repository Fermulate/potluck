import { fetchPushTokens, savePushToken, type Json } from '@potluck/api'
import { useCallback, useEffect, useState } from 'react'
import { useUserId } from '@/lib/auth'
import { useAppConfig } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import {
  currentPushSubscription,
  forgetPushSubscription,
  pushRegistration,
  pushSupported,
} from '@/lib/web-push'

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

/**
 * Web push for this device. The subscription lives in the browser; its endpoint is stored in
 * `push_tokens` so the `notify` edge function can reach it. It counts as on only when the
 * signed-in account owns that row, so a device handed to another account starts off.
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
    if (!pushSupported()) settle('unsupported')
    else if (!vapidKey || flagOff) settle('not-configured')
    else if (Notification.permission === 'denied') settle('blocked')
    else if (!configPending) {
      void currentPushSubscription()
        .then(async (sub) => {
          if (!sub) return false
          const tokens = await fetchPushTokens(supabase, userId)
          return tokens.some((row) => row.token === sub.endpoint)
        })
        .then((on) => settle(on ? 'on' : 'off'))
        .catch(() => settle('off'))
    }
    return () => {
      cancelled = true
    }
  }, [userId, vapidKey, flagOff, configPending])

  const enable = useCallback(async () => {
    if (!vapidKey) return false
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'off')
        return false
      }
      const reg = await pushRegistration()
      if (!reg) throw new Error('no_service_worker')
      const stale = await reg.pushManager.getSubscription()
      if (stale) await stale.unsubscribe()
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(vapidKey),
      })
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
      await forgetPushSubscription(userId)
      setState('off')
    } finally {
      setBusy(false)
    }
  }, [userId])

  return { state, busy, enable, disable }
}
