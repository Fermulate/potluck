import type { PotluckClient } from '@potluck/api'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { useSyncExternalStore } from 'react'
import { AUTH_RESULT_IN_URL, STORED_SESSION_KEY } from './boot-rule'

let current: Session | null = null
let lastUserId: string | null = null
let ready: Promise<Session | null> | null = null
let attached: PotluckClient | null = null
const listeners = new Set<() => void>()
const eventListeners = new Set<(event: AuthChangeEvent) => void>()

function emit() {
  for (const listener of listeners) listener()
}

/**
 * The Supabase client is a large download that a signed-out visitor on the landing page never
 * needs, so it is loaded on first use. Everything that talks to the database lives in lazily
 * loaded screens, which import `./supabase` themselves.
 */
export function loadSupabase(): Promise<PotluckClient> {
  return import('./supabase').then(({ supabase }) => {
    attachAuth(supabase)
    return supabase
  })
}

/**
 * Follows the client's auth state. Called when `./supabase` is first evaluated, whoever
 * imported it, so a sign in on a page that skipped the session lookup still lands here.
 */
export function attachAuth(client: PotluckClient) {
  if (attached) return
  attached = client
  client.auth.onAuthStateChange((event, session) => {
    current = session
    if (session) lastUserId = session.user.id
    emit()
    if (event === 'SIGNED_OUT' && eventListeners.size === 0) unheardSignOut = true
    for (const listener of eventListeners) listener(event)
  })
}

/**
 * A sign out that happened before anything listened: a page opened with a session that the
 * server had already ended is signed out by its first requests, while the router is still
 * loading. The first listener hears it late rather than never.
 */
let unheardSignOut = false

/** Auth events (sign out in another tab, password recovery) without loading the client. */
export function onAuthEvent(listener: (event: AuthChangeEvent) => void): () => void {
  eventListeners.add(listener)
  if (unheardSignOut && !current) {
    unheardSignOut = false
    queueMicrotask(() => {
      if (eventListeners.has(listener)) listener('SIGNED_OUT')
    })
  }
  return () => eventListeners.delete(listener)
}

/**
 * Whether reading the session needs the client now. Only the landing page, with no session
 * saved in this browser and no auth result in the URL, can answer "signed out" on its own.
 */
function sessionMayExist(): boolean {
  if (typeof window === 'undefined') return true
  const { pathname, search, hash } = window.location
  if (pathname !== '/') return true
  if (AUTH_RESULT_IN_URL.test(search + hash)) return true
  try {
    for (let i = 0; i < localStorage.length; i++) {
      if (STORED_SESSION_KEY.test(localStorage.key(i) ?? '')) return true
    }
    return false
  } catch {
    return true
  }
}

function start(): Promise<Session | null> {
  if (ready) return ready
  ready = sessionMayExist()
    ? loadSupabase()
        .then((supabase) => supabase.auth.getSession())
        .then(({ data }) => {
          current = data.session
          if (current) lastUserId = current.user.id
          emit()
          return current
        })
    : Promise.resolve(null)
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

/** The session's access token, for the one request sent outside the client (`rpc-keepalive`). */
export function accessToken(): string | null {
  return current?.access_token ?? null
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
 * `global` also revokes every other device's session.
 */
export async function signOut(scope: 'local' | 'global' = 'local') {
  const userId = current?.user.id ?? lastUserId
  if (userId) {
    const { forgetPushSubscription } = await import('./web-push')
    await forgetPushSubscription(userId).catch(() => undefined)
  }
  const supabase = await loadSupabase()
  if (scope === 'global') {
    const { error } = await supabase.auth.signOut({ scope: 'global' })
    if (error) throw error
    return
  }
  await supabase.auth.signOut()
}

/**
 * Signs this device out without asking the server. Used once the server has said the session is
 * gone ("Sign out everywhere" or a password change on another device): the `SIGNED_OUT` event
 * then clears the cache and leaves the app.
 */
export async function endEndedSession() {
  const supabase = await loadSupabase()
  const { data } = await supabase.auth.getSession()
  if (data.session) await supabase.auth.signOut({ scope: 'local' })
}

/**
 * Asks Supabase Auth whether this device's session still exists (`getUser` goes to the server,
 * unlike `getSession`). A session ended elsewhere answers `session_not_found` (or 401/403 for a
 * deleted account), and this device signs out. Network trouble changes nothing.
 */
export async function confirmSession(): Promise<void> {
  const supabase = await loadSupabase()
  const { data } = await supabase.auth.getSession()
  if (!data.session) return
  const { error } = await supabase.auth.getUser()
  if (!error) return
  const status = (error as { status?: number }).status
  const gone =
    error.name === 'AuthSessionMissingError' ||
    (error.name === 'AuthApiError' && (status === 401 || status === 403))
  if (gone) await endEndedSession()
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

/** The `aal` claim of a session's access token: `aal2` once a second factor was checked. */
export function assuranceLevel(session: Session): string {
  try {
    const payload = session.access_token.split('.')[1] ?? ''
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const aal = (JSON.parse(json) as { aal?: unknown }).aal
    return typeof aal === 'string' ? aal : 'aal1'
  } catch {
    return 'aal1'
  }
}

/**
 * Whether the person still owes the two-step code: they have a verified authenticator and this
 * session has not been stepped up yet. The database refuses such a session anyway (ADR 13);
 * this only decides where to send them.
 */
export function needsSecondFactor(session: Session | null): boolean {
  if (!session) return false
  const verified = session.user.factors?.some((f) => f.status === 'verified') ?? false
  return verified && assuranceLevel(session) !== 'aal2'
}

/**
 * Whether to send the person through onboarding first. Accounts carry the `onboarded` flag once
 * they have saved their profile, so this holds for every sign in method, OAuth included.
 */
export function needsOnboarding(session: Session | null): boolean {
  return session ? session.user.user_metadata?.onboarded !== true : false
}
