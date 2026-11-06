import { createSupabaseClient } from '@potluck/api'
import { attachAuth } from './auth'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
export const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'missing-publishable-key'

export const supabase = createSupabaseClient(supabaseUrl, supabaseKey)
attachAuth(supabase)
