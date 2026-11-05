import { describe, expect, it } from 'vitest'
import type { PotluckClient } from './index'
import { fetchFxRate, fetchGroupExpenses } from './money'

type Row = Record<string, unknown>

/**
 * In-memory stand-in for the PostgREST table API, enough for the reads under test. Like the
 * local stack (supabase/config.toml `max_rows = 1000`), no response carries more than
 * `maxRows` rows, whatever `limit` or `range` asks for.
 */
function fakeClient(tables: Record<string, Row[]>, maxRows = 1000): PotluckClient {
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = []
    let sort: { column: string; ascending: boolean } | null = null
    let offset = 0
    let count = Infinity
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => (filters.push((r) => r[column] === value), builder),
      is: (column: string, value: unknown) => (filters.push((r) => r[column] === value), builder),
      lte: (column: string, value: string) => (
        filters.push((r) => String(r[column]) <= value),
        builder
      ),
      order: (column: string, opts?: { ascending?: boolean }) => {
        sort ??= { column, ascending: opts?.ascending ?? true }
        return builder
      },
      limit: (n: number) => ((count = n), builder),
      range: (a: number, b: number) => ((offset = a), (count = b - a + 1), builder),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
        let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
        if (sort) {
          const { column, ascending } = sort
          rows = [...rows].sort(
            (x, y) => String(x[column]).localeCompare(String(y[column])) * (ascending ? 1 : -1),
          )
        }
        return resolve({ data: rows.slice(offset, offset + Math.min(count, maxRows)), error: null })
      },
    }
    return builder
  }
  return { from } as unknown as PotluckClient
}

describe('fetchGroupExpenses', () => {
  it('returns every live expense even past the per response row cap', async () => {
    const expenses = Array.from({ length: 2500 }, (_, i) => ({
      id: `e${i}`,
      group_id: 'g1',
      deleted_at: null,
      spent_at: `2026-01-01T00:00:${String(i).padStart(5, '0')}`,
      expense_splits: [],
    }))
    const other = { id: 'x', group_id: 'g2', deleted_at: null, spent_at: '2026-01-01' }
    const deleted = { id: 'd', group_id: 'g1', deleted_at: '2026-02-01', spent_at: '2026-01-01' }
    const client = fakeClient({ expenses: [...expenses, other, deleted] })

    const rows = await fetchGroupExpenses(client, 'g1')

    expect(rows).toHaveLength(2500)
    expect(new Set(rows.map((r) => r.id)).size).toBe(2500)
  })
})

describe('fetchFxRate', () => {
  const fxRates = [
    { base: 'EUR', quote: 'USD', day: '2026-03-01', rate: 1.1 },
    { base: 'EUR', quote: 'USD', day: '2026-06-01', rate: 1.2 },
    { base: 'USD', quote: 'GBP', day: '2026-06-01', rate: 0.8 },
  ]
  const client = fakeClient({ fx_rates: fxRates })

  it('uses the newest rate on or before the expense day, like private.fx_rate', async () => {
    expect(await fetchFxRate(client, 'EUR', 'USD', '2026-04-15')).toEqual({
      rate: 1.1,
      day: '2026-03-01',
    })
    expect(await fetchFxRate(client, 'EUR', 'USD', '2026-06-01')).toEqual({
      rate: 1.2,
      day: '2026-06-01',
    })
  })

  it('has no rate for a day before the first known rate', async () => {
    expect(await fetchFxRate(client, 'EUR', 'USD', '2026-02-28')).toBeNull()
    expect(await fetchFxRate(client, 'GBP', 'USD', '2026-05-31')).toBeNull()
  })

  it('falls back to the inverse pair, rounded to 8 places', async () => {
    expect(await fetchFxRate(client, 'GBP', 'USD', '2026-07-01')).toEqual({
      rate: 1.25,
      day: '2026-06-01',
    })
  })
})
