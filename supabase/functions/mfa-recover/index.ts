// Signs someone in with a two-step recovery code when their authenticator is gone. The caller
// has already proved their password (or email link): their aal1 token gets them here. A
// matching code removes every second factor and every recovery code; the app then refreshes
// the session, which is complete without a factor. See ADR 11.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { adminClient } from '../_shared/admin.ts'
import { corsHeaders, json } from '../_shared/http.ts'
import { recover } from './recover.ts'

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

  const body = (await req.json().catch(() => ({}))) as { code?: unknown }
  const admin = adminClient()
  const result = await recover(userData.user.id, body.code, {
    allowAttempt: async (userId) => {
      const { data, error } = await admin.rpc('record_mfa_recover_attempt', { target: userId })
      if (error) throw error
      return data === true
    },
    matches: async (userId, code) => {
      const { data, error } = await admin.rpc('mfa_recovery_code_matches', {
        target: userId,
        code,
      })
      if (error) throw error
      return data === true
    },
    factorIds: async (userId) => {
      const { data, error } = await admin.auth.admin.mfa.listFactors({ userId })
      if (error) throw error
      return data.factors.map((f) => f.id)
    },
    deleteFactor: async (userId, id) => {
      const { error } = await admin.auth.admin.mfa.deleteFactor({ userId, id })
      if (error) throw error
    },
    forgetCodes: async (userId) => {
      const { error } = await admin.rpc('forget_mfa_recovery_codes', { target: userId })
      if (error) throw error
    },
  }).catch(() => ({ ok: false as const, status: 500 as const, error: 'recovery_failed' as const }))

  return result.ok ? json({ ok: true }) : json({ error: result.error }, result.status)
})
