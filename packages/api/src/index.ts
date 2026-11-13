/**
 * Supabase client and TanStack Query helpers shared by web and mobile.
 * No DOM or React DOM imports.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export type { Database, Json } from './database.types'

export type PotluckClient = SupabaseClient<Database>

export function createSupabaseClient(url: string, publishableKey: string): PotluckClient {
  return createClient<Database>(url, publishableKey)
}

export const queryKeys = {
  all: ['potluck'] as const,
}

export * from './groups'
export * from './money'
export * from './plans'
export * from './me'
export * from './notification-prefs'
