// Closes the caller's account: tombstones their data with delete_my_account()
// (as the caller, so the RPC's own checks apply), then soft deletes the auth
// user so profile foreign keys and shared ledgers stay intact. Avatar files
// are removed too.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { adminClient } from '../_shared/admin.ts'
import { corsHeaders, json } from '../_shared/http.ts'

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

  const { error: rpcError } = await asUser.rpc('delete_my_account')
  if (rpcError) return json({ error: rpcError.message }, 400)

  const admin = adminClient()
  const uid = userData.user.id
  // Avatar files live under `<uid>/` in the public avatars bucket.
  const { data: files } = await admin.storage.from('avatars').list(uid, { limit: 1000 })
  if (files?.length) {
    await admin.storage.from('avatars').remove(files.map((f) => `${uid}/${f.name}`))
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(uid, true)
  if (deleteError) return json({ error: 'auth_delete_failed' }, 500)

  return json({ ok: true })
})
