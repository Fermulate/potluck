/**
 * Drop-in for `@/lib/supabase` in screen tests:
 *
 *   vi.mock('@/lib/supabase', () => import('@/test/supabase'))
 *
 * The real `@potluck/api` functions run against the shared in-memory fake from the api package,
 * so tests can seed tables, queue RPC answers and assert on the recorded calls. Realtime
 * channels are recorded too, and `emitChange` replays a Postgres change to every listener.
 */
import {
  argsOf,
  fakeSupabase,
  type Call,
  type FakeOptions,
  type FakeResult,
  type QueryCall,
} from '../../../../packages/api/src/testing/fake-supabase'

export { argsOf }
export type { Call, QueryCall }

/** The first `.update(patch)` / `.insert(rows)` / `.upsert(rows)` payload in a recorded chain. */
export function payloadOf(call: Call, method: 'update' | 'insert' | 'upsert'): unknown {
  return call.kind === 'from' ? argsOf(call, method)[0]?.[0] : undefined
}

type Handler = (payload: { table: string; eventType: string; new: unknown; old: unknown }) => void

interface Listener {
  topic: string
  table: string
  filter?: string
  handler: Handler
}

let fake = fakeSupabase()
let listeners: Listener[] = []
let authCalls: { method: string; args: unknown[] }[] = []
let authResults = new Map<string, FakeResult>()

/** Starts every test from an empty database; returns the fake for seeding and assertions. */
export function resetDb(options: FakeOptions = {}) {
  fake = fakeSupabase(options)
  listeners = []
  authCalls = []
  authResults = new Map()
  return fake
}

export function db() {
  return fake
}

/** Canned answer for one `supabase.auth.<method>()`; anything else resolves without data. */
export function respondAuth(method: string, result: FakeResult) {
  authResults.set(method, result)
}

/** Every `supabase.auth.<method>()` call, in order. */
export function authCallsTo(method: string) {
  return authCalls.filter((call) => call.method === method).map((call) => call.args)
}

/** Realtime topics currently subscribed. */
export function subscribedTables() {
  return listeners.map((l) => l.table)
}

export function emitChange(table: string, eventType = 'INSERT', row: unknown = {}) {
  for (const l of listeners.filter((l) => l.table === table)) {
    l.handler({ table, eventType, new: row, old: {} })
  }
}

function channel(topic: string) {
  const pending: Listener[] = []
  const ch = {
    topic,
    on(_type: string, filter: { table: string; filter?: string }, handler: Handler) {
      pending.push({ topic, table: filter.table, filter: filter.filter, handler })
      return ch
    },
    subscribe() {
      listeners.push(...pending)
      return ch
    },
  }
  return ch
}

const auth = new Proxy(
  {},
  {
    get(_target, method) {
      if (typeof method !== 'string') return undefined
      if (method === 'onAuthStateChange') {
        return () => ({ data: { subscription: { unsubscribe: () => undefined } } })
      }
      return async (...args: unknown[]) => {
        authCalls.push({ method, args })
        return { data: {}, error: null, ...authResults.get(method) }
      }
    },
  },
)

export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === 'channel') return channel
      if (prop === 'removeChannel') {
        return async (ch: { topic: string }) => {
          listeners = listeners.filter((l) => l.topic !== ch.topic)
          return 'ok'
        }
      }
      if (prop === 'auth') return auth
      return (fake.client as unknown as Record<string | symbol, unknown>)[prop]
    },
  },
) as typeof fake.client

export const supabaseUrl = 'https://db.test'
