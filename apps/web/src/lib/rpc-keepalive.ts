import { accessToken } from './auth'
import { supabaseKey, supabaseUrl } from './supabase'

/**
 * Calls a database function on a request the browser finishes even after the page is gone. The
 * client's own fetch is dropped at unload, so the save `pagehide` sends goes through here; it
 * carries the same payload PostgREST gets from `client.rpc(name, args)`.
 */
export function rpcKeepalive(name: string, args: Record<string, unknown>): Promise<Response> {
  return fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    keepalive: true,
    headers: {
      apikey: supabaseKey,
      authorization: `Bearer ${accessToken() ?? supabaseKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  })
}
