import { createSupabaseClient } from '@potluck/api'
import { createClient } from '@supabase/supabase-js'
import { attachAuth } from './auth'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
export const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'missing-publishable-key'

export const supabase = createSupabaseClient(supabaseUrl, supabaseKey)
attachAuth(supabase)

/**
 * A throwaway client that keeps its session in memory, for checking a password without
 * touching the signed-in session of this tab.
 */
export function isolatedClient() {
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
