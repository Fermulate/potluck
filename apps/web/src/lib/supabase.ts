import { createSupabaseClient } from '@potluck/api'

const url = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'missing-publishable-key'

export const supabase = createSupabaseClient(url, key)
