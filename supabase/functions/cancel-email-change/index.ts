// Calls off an email change that is waiting for its confirmation links. Supabase has no client
// call for that, but setting the address to the current one with the admin API clears the
// pending change and makes its links useless.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { adminClient } from '../_shared/admin.ts'
import { corsHeaders, json } from '../_shared/http.ts'
import { decide, tokenAal } from './cancel.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authorization = req.headers.get('Authorization')
  if (!authorization) return json({ error: 'not_authenticated' }, 401)

  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await asUser.auth.getUser()
  if (userError || !userData.user) return json({ error: 'not_authenticated' }, 401)

  const decision = decide(userData.user, tokenAal(authorization))
  if (!decision.ok) return json({ error: decision.error }, decision.status)

  const { error } = await adminClient().auth.admin.updateUserById(userData.user.id, {
    email: decision.email,
  })
  if (error) return json({ error: 'cancel_failed' }, 500)
  return json({ ok: true })
})
