// One-click unsubscribe target for the List-Unsubscribe header of every notification email:
// POST /functions/v1/unsubscribe?token=...  (see handle.ts). No JWT: the token is the credential.
import { handleUnsubscribe, rpcUnsubscribe } from './handle.ts'

const appUrl = Deno.env.get('APP_URL') ?? 'https://potluck.fermulate.com'
const unsubscribe = rpcUnsubscribe(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!,
)

Deno.serve((req) => handleUnsubscribe(req, { appUrl, unsubscribe }))
