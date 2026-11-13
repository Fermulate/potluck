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

type Row = Record<string, unknown>

let fake = fakeSupabase()
let tables: Record<string, Row[]> = {}
let listeners: Listener[] = []
let authCalls: { method: string; args: unknown[] }[] = []
type AuthResponder = FakeResult | (() => Promise<unknown>)
let authResults = new Map<string, AuthResponder>()
const authListeners = new Set<(event: string, session: unknown) => void>()

/** Starts every test from an empty database; returns the fake for seeding and assertions. */
export function resetDb(options: FakeOptions = {}) {
  tables = options.tables ?? {}
  fake = fakeSupabase({ ...options, tables })
  listeners = []
  authCalls = []
  authResults = new Map()
  return fake
}

export function db() {
  return fake
}

/** Current rows of a seeded table, after any writes the screen made. */
export function rowsOf(table: string): Row[] {
  return tables[table] ?? []
}

const WRITES = ['insert', 'upsert', 'update', 'delete']

/** Column defaults a screen reads back after inserting (Postgres fills them in). */
const INSERT_DEFAULTS: Record<string, () => Row> = {
  comments: () => ({ created_at: new Date().toISOString(), deleted_at: null }),
}

/**
 * The api fake only reads seeded tables. Writes to a seeded table (with no canned answer) are
 * applied here instead: filters pick the rows, and `.select()` gets the written rows back.
 */
function applyWrite(table: string, call: QueryCall): FakeResult {
  const rows = tables[table]!
  const write = call.ops.find((op) => WRITES.includes(op.method))!
  const matches = (row: Row) =>
    call.ops.every(({ method, args }) => {
      const [column, value] = args as [string, unknown]
      if (method === 'eq') return row[column] === value
      // A column a fixture leaves out reads as null, as an unset column does in Postgres.
      if (method === 'is') return (row[column] ?? null) === value
      if (method === 'neq') return row[column] !== value
      if (method === 'in') return (value as unknown[]).includes(row[column])
      return true
    })
  let written: Row[] = []
  if (write.method === 'insert' || write.method === 'upsert') {
    const input = write.args[0] as Row | Row[]
    written = (Array.isArray(input) ? input : [input]).map((row) => ({ ...row }))
    const conflict = (write.args[1] as { onConflict?: string } | undefined)?.onConflict
    for (const row of written) {
      const keys = conflict ? conflict.split(',') : ['id']
      const at = rows.findIndex((r) => keys.every((k) => r[k] !== undefined && r[k] === row[k]))
      if (write.method === 'upsert' && at >= 0) rows[at] = { ...rows[at], ...row }
      else rows.push({ ...INSERT_DEFAULTS[table]?.(), ...row })
    }
  } else if (write.method === 'update') {
    const patch = write.args[0] as Row
    rows.forEach((row, i) => {
      if (matches(row)) {
        rows[i] = { ...row, ...patch }
        written.push(rows[i]!)
      }
    })
  } else {
    written = rows.filter(matches)
    tables[table] = rows.filter((row) => !written.includes(row))
  }
  const single = call.ops.some((op) => op.method === 'single' || op.method === 'maybeSingle')
  return { data: single ? (written[0] ?? null) : written, error: null }
}

function from(table: string) {
  const builder = fake.client.from(table as never) as unknown as Row
  const call = fake.calls[fake.calls.length - 1] as QueryCall
  const wrapped: unknown = new Proxy(builder, {
    get(target, prop) {
      if (prop === 'then') {
        return (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
          (target.then as (a: unknown, b: unknown) => Promise<unknown>)(
            (value: unknown) => value,
            (error: unknown) => {
              if (tables[table] && call.ops.some((op) => WRITES.includes(op.method))) {
                return applyWrite(table, call)
              }
              throw error
            },
          ).then(onFulfilled, onRejected)
      }
      const value = target[prop as string]
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        ;(value as (...a: unknown[]) => unknown)(...args)
        return wrapped
      }
    },
  })
  return wrapped
}

/**
 * Canned answer for one `supabase.auth.<method>()`, or a function for full control (e.g. a
 * promise that never settles). Anything else resolves without data.
 */
export function respondAuth(method: string, result: AuthResponder) {
  authResults.set(method, result)
}

/** Fires an auth event (`SIGNED_OUT`, `PASSWORD_RECOVERY`, ...) at every subscriber. */
export function emitAuth(event: string, session: unknown = null) {
  for (const listener of [...authListeners]) listener(event, session)
}

/** Every `supabase.auth.<method>()` call, in order. */
export function authCallsTo(method: string) {
  return authCalls.filter((call) => call.method === method).map((call) => call.args)
}

/** Realtime topics currently subscribed. */
export function subscribedTables() {
  return listeners.map((l) => l.table)
}

/** Realtime subscriptions currently live, with their filters. */
export function subscriptions() {
  return listeners.map((l) => ({ table: l.table, filter: l.filter }))
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

/** `supabase.auth.mfa.<method>()` is recorded and answered as `mfa.<method>`. */
function authMethods(prefix: string): object {
  return new Proxy(
    {},
    {
      get(_target, method) {
        if (typeof method !== 'string') return undefined
        if (method === 'mfa' && !prefix) return authMethods('mfa.')
        if (method === 'onAuthStateChange' && !prefix) {
          return (listener: (event: string, session: unknown) => void) => {
            authListeners.add(listener)
            return {
              data: { subscription: { unsubscribe: () => authListeners.delete(listener) } },
            }
          }
        }
        const name = prefix + method
        return async (...args: unknown[]) => {
          authCalls.push({ method: name, args })
          const result = authResults.get(name)
          if (typeof result === 'function') return result()
          return { data: {}, error: null, ...result }
        }
      },
    },
  )
}

/** Stands in for `isolatedClient()`: its auth calls are recorded as `isolated.<method>`. */
export function isolatedClient() {
  return { auth: authMethods('isolated.') }
}

const auth = authMethods('')

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
      if (prop === 'from') return from
      return (fake.client as unknown as Record<string | symbol, unknown>)[prop]
    },
  },
) as typeof fake.client

export const supabaseUrl = 'https://db.test'
export const supabaseKey = 'test-key'
