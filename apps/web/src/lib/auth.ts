import type { Session } from '@supabase/supabase-js'
import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'

let current: Session | null = null
let ready: Promise<Session | null> | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function start(): Promise<Session | null> {
  if (ready) return ready
  ready = supabase.auth.getSession().then(({ data }) => {
    current = data.session
    emit()
    return current
  })
  supabase.auth.onAuthStateChange((_event, session) => {
    current = session
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

/** The signed-in user's id. Only call under the authenticated `_app` layout. */
export function useUserId(): string {
  const session = useSession()
  if (!session) throw new Error('useUserId called without a session')
  return session.user.id
}

export async function signOut() {
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

/** New accounts carry this flag until they finish onboarding. */
export function needsOnboarding(session: Session | null): boolean {
  return session?.user.user_metadata?.needs_onboarding === true
}
