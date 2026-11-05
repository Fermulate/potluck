import { createClient } from '@supabase/supabase-js'
import { resolveStackEnv } from './support/env'

/**
 * Resolves the stack keys once for every worker, and makes sure the FX rates the multi-currency
 * journey needs exist for today (the seed only covers the days around `supabase start`).
 */
export default async function globalSetup() {
  const env = resolveStackEnv()
  process.env.E2E_SUPABASE_URL = env.url
  process.env.E2E_PUBLISHABLE_KEY = env.publishableKey
  process.env.E2E_SERVICE_ROLE_KEY = env.serviceRoleKey

  const admin = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const today = new Date().toISOString().slice(0, 10)
  const { error } = await admin
    .from('fx_rates')
    .upsert([{ base: 'EUR', quote: 'USD', day: today, rate: 1.1 }], {
      onConflict: 'base,quote,day',
      ignoreDuplicates: true,
    })
  if (error) throw new Error(`Seeding FX rates failed: ${error.message}`)
}
