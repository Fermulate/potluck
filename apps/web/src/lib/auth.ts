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
