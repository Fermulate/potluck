/**
 * In-memory stand-in for the typed Supabase client, for unit tests only.
 *
 * Every `.from(table)` chain, `.rpc(name, args)`, storage, auth and edge function call is
 * recorded in `calls`. Responses come from, in order:
 *   1. canned results queued with `respond(key, ...)` (the last one sticks for later calls),
 *   2. the in-memory `tables`, for plain reads (eq / is / in / like / lt / lte / gt / gte / or / order /
 *      limit / range / single / maybeSingle), capped at `maxRows` like PostgREST `max_rows`,
 *   3. `{ data: null, error: null }`.
 *
 * Keys: `from:<table>`, `rpc:<name>`, `storage:<bucket>.<method>`, `functions:<name>`.
 */
import type { PotluckClient } from '../index'

export type Row = Record<string, unknown>

export interface Op {
  method: string
  args: unknown[]
}

export interface QueryCall {
  kind: 'from'
  table: string
  ops: Op[]
}

export type Call =
  | QueryCall
  | { kind: 'rpc'; name: string; args: unknown; range?: [number, number] }
  | { kind: 'storage'; bucket: string; method: string; args: unknown[] }
  | { kind: 'auth'; method: string; args: unknown[] }
  | { kind: 'functions'; name: string; args: unknown[] }

export interface FakeResult {
  data?: unknown
  error?: unknown
  count?: number | null
}

export type Responder = FakeResult | ((call: Call) => FakeResult)

export interface FakeOptions {
  /** The signed-in user `auth.getUser()` reports. Defaults to nobody. */
  user?: { id: string } | null
  tables?: Record<string, Row[]>
  maxRows?: number
}

/** Arguments of every `method` call in a recorded query chain, in order. */
export function argsOf(call: QueryCall, method: string): unknown[][] {
  return call.ops.filter((op) => op.method === method).map((op) => op.args)
}

function compare(a: unknown, b: unknown) {
  return String(a).localeCompare(String(b))
}

/** Splits a PostgREST logic list on top level commas, leaving nested and()/or() and quotes. */
function splitTerms(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const ch of list) {
    if (ch === '"') quoted = !quoted
    if (!quoted && ch === '(') depth += 1
    if (!quoted && ch === ')') depth -= 1
    if (!quoted && depth === 0 && ch === ',') {
      out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  out.push(current)
  return out
}

const COMPARE: Record<string, (c: number) => boolean> = {
  eq: (c) => c === 0,
  neq: (c) => c !== 0,
  lt: (c) => c < 0,
  lte: (c) => c <= 0,
  gt: (c) => c > 0,
  gte: (c) => c >= 0,
}

/** A row predicate for one `or()` / `and()` term such as `and(a.eq.1,b.lt."x")`. */
function logicFilter(term: string): (row: Row) => boolean {
  const group = /^(and|or)\((.*)\)$/.exec(term)
  if (group) {
    const parts = splitTerms(group[2]!).map(logicFilter)
    return group[1] === 'and'
      ? (row) => parts.every((p) => p(row))
      : (row) => parts.some((p) => p(row))
  }
  const match = /^([^.]+)\.(eq|neq|lt|lte|gt|gte)\.(.*)$/.exec(term)
  if (!match) throw new Error(`fake-supabase: cannot read the filter ${term}`)
  const [, column, op, raw] = match
  const value = raw!.replace(/^"(.*)"$/, '$1')
  return (row) => COMPARE[op!]!(compare(row[column!], value))
}

function runInMemory(rows: Row[], ops: Op[], maxRows: number): FakeResult {
  let out = rows
  const sorts: { column: string; ascending: boolean }[] = []
  let offset = 0
  let count = Infinity
  let single: 'single' | 'maybeSingle' | null = null
  for (const { method, args } of ops) {
    const [column, value] = args as [string, unknown]
    switch (method) {
      case 'eq':
        out = out.filter((r) => r[column] === value)
        break
      case 'is':
        // A column a fixture leaves out reads as null, as an unset column does in Postgres.
        out = out.filter((r) => (r[column] ?? null) === value)
        break
      case 'neq':
        out = out.filter((r) => r[column] !== value)
        break
      case 'in':
        out = out.filter((r) => (value as unknown[]).includes(r[column]))
        break
      case 'like': {
        const pattern = new RegExp(
          `^${String(value)
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replaceAll('%', '.*')
            .replaceAll('_', '.')}$`,
        )
        out = out.filter((r) => pattern.test(String(r[column])))
        break
      }
      case 'or':
        out = out.filter(logicFilter(`or(${column})`))
        break
      case 'lt':
        out = out.filter((r) => compare(r[column], value) < 0)
        break
      case 'lte':
        out = out.filter((r) => compare(r[column], value) <= 0)
        break
      case 'gt':
        out = out.filter((r) => compare(r[column], value) > 0)
        break
      case 'gte':
        out = out.filter((r) => compare(r[column], value) >= 0)
        break
      case 'order': {
        const opts = args[1] as { ascending?: boolean } | undefined
        sorts.push({ column, ascending: opts?.ascending ?? true })
        break
      }
      case 'limit':
        count = args[0] as number
        break
      case 'range':
        offset = args[0] as number
        count = (args[1] as number) - offset + 1
        break
      case 'single':
      case 'maybeSingle':
        single = method
        break
      case 'select':
        break
      default:
        throw new Error(`fake-supabase: ${method}() is not supported on in-memory tables`)
    }
  }
  if (sorts.length) {
    out = [...out].sort((x, y) => {
      for (const { column, ascending } of sorts) {
        const c = compare(x[column], y[column]) * (ascending ? 1 : -1)
        if (c) return c
      }
      return 0
    })
  }
  out = out.slice(offset, offset + Math.min(count, maxRows))
  if (single === 'maybeSingle') return { data: out[0] ?? null, error: null }
  if (single === 'single') {
    return out.length === 1
      ? { data: out[0], error: null }
      : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } }
  }
  return { data: out, error: null, count: out.length }
}

export function fakeSupabase(options: FakeOptions = {}) {
  const { user = null, tables = {}, maxRows = 1000 } = options
  const calls: Call[] = []
  const queues = new Map<string, Responder[]>()

  function next(key: string, call: Call): FakeResult | undefined {
    const queue = queues.get(key)
    if (!queue?.length) return undefined
    const responder = queue.length > 1 ? queue.shift()! : queue[0]!
    return typeof responder === 'function' ? responder(call) : responder
  }

  function settle(result: FakeResult | undefined) {
    return { data: null, error: null, ...result }
  }

  function from(table: string) {
    const call: QueryCall = { kind: 'from', table, ops: [] }
    calls.push(call)
    const resolve = () => {
      const canned = next(`from:${table}`, call)
      if (canned) return settle(canned)
      const rows = tables[table]
      return settle(rows ? runInMemory(rows, call.ops, maxRows) : undefined)
    }
    const builder: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
              Promise.resolve().then(resolve).then(onFulfilled, onRejected)
          }
          if (typeof prop !== 'string') return undefined
          return (...args: unknown[]) => {
            call.ops.push({ method: prop, args })
            return builder
          }
        },
      },
    )
    return builder
  }

  function rpc(name: string, args?: unknown) {
    const call: Extract<Call, { kind: 'rpc' }> = { kind: 'rpc', name, args }
    calls.push(call)
    // Resolves when awaited, so a `.range()` chained on it is recorded first.
    const result = {
      range(first: number, last: number) {
        call.range = [first, last]
        return result
      },
      then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        return Promise.resolve()
          .then(() => settle(next(`rpc:${name}`, call)))
          .then(onFulfilled, onRejected)
      },
    }
    return result
  }

  const storage = {
    from(bucket: string) {
      return new Proxy(
        {},
        {
          get(_target, method) {
            if (typeof method !== 'string') return undefined
            return (...args: unknown[]) => {
              const call: Call = { kind: 'storage', bucket, method, args }
              calls.push(call)
              const canned = next(`storage:${bucket}.${method}`, call)
              if (method === 'getPublicUrl') {
                return (
                  canned ?? {
                    data: { publicUrl: `https://storage.test/${bucket}/${String(args[0])}` },
                  }
                )
              }
              return Promise.resolve(settle(canned))
            }
          },
        },
      )
    },
  }

  const auth = {
    async getUser(...args: unknown[]) {
      calls.push({ kind: 'auth', method: 'getUser', args })
      return { data: { user }, error: null }
    },
  }

  const functions = {
    async invoke(name: string, ...args: unknown[]) {
      const call: Call = { kind: 'functions', name, args }
      calls.push(call)
      return settle(next(`functions:${name}`, call))
    },
  }

  const client = { from, rpc, storage, auth, functions } as unknown as PotluckClient

  const fake = {
    client,
    calls,
    /** Queue canned results for a key; the last one answers every later call. */
    respond(key: string, ...results: Responder[]) {
      queues.set(key, [...(queues.get(key) ?? []), ...results])
      return fake
    },
    /** Recorded `.from(table)` chains, optionally for one table. */
    queries(table?: string) {
      return calls.filter(
        (c): c is QueryCall => c.kind === 'from' && (table === undefined || c.table === table),
      )
    },
    /** Arguments of every `.rpc(name, args)` call to one function. */
    rpcArgs(name: string) {
      return calls.flatMap((c) => (c.kind === 'rpc' && c.name === name ? [c.args] : []))
    },
    /** Recorded storage calls, optionally for one bucket. */
    storageCalls(bucket?: string) {
      return calls.filter(
        (c): c is Extract<Call, { kind: 'storage' }> =>
          c.kind === 'storage' && (bucket === undefined || c.bucket === bucket),
      )
    },
  }
  return fake
}
