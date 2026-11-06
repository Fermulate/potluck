import { accessToken } from './auth'
import { supabaseKey, supabaseUrl } from './supabase'

/** Browsers refuse a keepalive body past 64 KiB; stay under it with room for other requests. */
export const KEEPALIVE_BODY_LIMIT = 60_000

/**
 * Calls a database function on a request the browser finishes even after the page is gone, with
 * the payload PostgREST gets from `client.rpc(name, args)`. The client's own fetch is dropped at
 * unload, so the save `pagehide` sends goes through here. Returns false without sending when
 * there is no session to send as, or the body is over the keepalive quota; the caller then uses
 * the client as usual. The answer is not waited for: the page is on its way out.
 */
export function rpcKeepalive(name: string, args: Record<string, unknown>): boolean {
  const token = accessToken()
  if (!token) return false
  const body = JSON.stringify(args)
  if (new TextEncoder().encode(body).byteLength > KEEPALIVE_BODY_LIMIT) return false
  void fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    keepalive: true,
    headers: {
      apikey: supabaseKey,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body,
  }).catch(() => undefined)
  return true
}
