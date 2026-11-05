import { createClient } from 'npm:@supabase/supabase-js@2'

/** Service-role client. Bypasses RLS: only use after authorizing the caller. */
export function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
