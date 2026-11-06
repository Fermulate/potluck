// Pulls daily reference rates from Frankfurter (ECB data, free, no key) and
// stores every pair between the supported currencies, so the database can
// convert in either direction. Called daily by pg_cron through the
// `invoke_edge_function` hook. `?from=YYYY-MM-DD` backfills a range.
import { adminClient } from '../_shared/admin.ts'
import { hasEdgeSecret, json } from '../_shared/http.ts'

const CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'NZD',
  'JPY',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'HUF',
  'MXN',
  'BRL',
  'INR',
  'CNY',
  'HKD',
  'SGD',
  'KRW',
  'ZAR',
  'TRY',
  'ILS',
  'THB',
  'PHP',
  'IDR',
  'MYR',
]

type Rates = Record<string, number>

function crossRows(day: string, eurRates: Rates) {
  const perEur: Rates = { ...eurRates, EUR: 1 }
  const rows: { base: string; quote: string; day: string; rate: number }[] = []
  for (const base of CURRENCIES) {
    for (const quote of CURRENCIES) {
      if (base === quote || !perEur[base] || !perEur[quote]) continue
      rows.push({ base, quote, day, rate: Number((perEur[quote] / perEur[base]).toFixed(12)) })
    }
  }
  return rows
}

Deno.serve(async (req) => {
  if (!hasEdgeSecret(req)) return json({ error: 'forbidden' }, 403)

  const from = new URL(req.url).searchParams.get('from')
  const symbols = CURRENCIES.filter((c) => c !== 'EUR').join(',')
  const range = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}..` : 'latest'
  const res = await fetch(`https://api.frankfurter.dev/v1/${range}?base=EUR&symbols=${symbols}`)
  if (!res.ok) return json({ error: 'upstream', status: res.status }, 502)
  const body = await res.json()

  const days: [string, Rates][] =
    range === 'latest'
      ? [[body.date as string, body.rates as Rates]]
      : Object.entries(body.rates as Record<string, Rates>)

  const rows = days.flatMap(([day, rates]) => crossRows(day, rates))
  const db = adminClient()
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await db.from('fx_rates').upsert(rows.slice(i, i + 1000))
    if (error) return json({ error: error.message }, 500)
  }
  return json({ days: days.length, rows: rows.length })
})
