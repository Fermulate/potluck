import type { Session } from '@supabase/supabase-js'
import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { forgetPushSubscription } from './web-push'

let current: Session | null = null
let lastUserId: string | null = null
let ready: Promise<Session | null> | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function start(): Promise<Session | null> {
  if (ready) return ready
  ready = supabase.auth.getSession().then(({ data }) => {
    current = data.session
    if (current) lastUserId = current.user.id
    emit()
    return current
  })
  supabase.auth.onAuthStateChange((_event, session) => {
    current = session
    if (session) lastUserId = session.user.id
    emit()
  })
  return ready
}

/** Resolves once the stored session has been read. Use in route `beforeLoad`. */
export async function getSession(): Promise<Session | null> {
  await start()
  return current
}

function subscribe(listener: () => void) {
  void start()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, () => current)
}

/**
 * The signed-in user's id. Only call under the authenticated `_app` layout. Right after sign
 * out it keeps returning the last id for the one render before the redirect lands.
 */
export function useUserId(): string {
  const session = useSession()
  const id = session?.user.id ?? lastUserId
  if (!id) throw new Error('useUserId called without a session')
  return id
}

/**
 * Ends the session. This browser's push registration goes first so the next account on the
 * device does not get this one's notifications; sign out proceeds even if that fails.
 */
export async function signOut() {
  const userId = current?.user.id ?? lastUserId
  if (userId) await forgetPushSubscription(userId).catch(() => undefined)
  await supabase.auth.signOut()
}

/**
 * Only same-origin paths survive the `redirect` search param, so a crafted link cannot bounce a
 * fresh session to another site.
 */
export function safeRedirect(target: string | undefined | null, fallback = '/home'): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) {
    return fallback
  }
  return target
}

/** Absolute URL of the auth callback, carrying where to go afterwards. */
export function authCallbackUrl(next?: string): string {
  const url = new URL('/auth/callback', window.location.origin)
  if (next) url.searchParams.set('redirect', next)
  return url.toString()
}

/**
 * Whether to send the person through onboarding first. Accounts carry the `onboarded` flag once
 * they have saved their profile, so this holds for every sign in method, OAuth included.
 */
export function needsOnboarding(session: Session | null): boolean {
  return session ? session.user.user_metadata?.onboarded !== true : false
}
