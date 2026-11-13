// One-click unsubscribe (RFC 8058). No Deno APIs, so the tests run under Node too.
//
// Mail clients POST `List-Unsubscribe=One-Click` to the URL in the List-Unsubscribe header,
// with no cookies or headers we could check, so the signed token in the query string is the
// only credential. This function holds no privilege: it calls the anon-callable
// public.email_unsubscribe(token) RPC with the publishable key, and Postgres checks the token.
// A GET (a person opening the header link, or a link scanner) changes nothing here and
// redirects to the web app's /unsubscribe page.

export type UnsubscribeOutcome =
  { ok: true; category: string } | { ok: false; invalid: boolean; message: string }

export interface UnsubscribeDeps {
  appUrl: string
  unsubscribe: (token: string) => Promise<UnsubscribeOutcome>
}

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

export async function handleUnsubscribe(req: Request, deps: UnsubscribeDeps): Promise<Response> {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (req.method === 'GET') {
    const page = new URL('/unsubscribe', deps.appUrl)
    if (token) page.searchParams.set('token', token)
    return new Response(null, { status: 303, headers: { Location: page.toString() } })
  }
  if (req.method !== 'POST') return text('Method not allowed', 405)
  if (!token) return text('Missing token', 400)

  const outcome = await deps.unsubscribe(token)
  if (outcome.ok) return text('You are unsubscribed.', 200)
  return outcome.invalid
    ? text('This unsubscribe link is not valid.', 400)
    : text('Try again later.', 502)
}

/** Calls public.email_unsubscribe through PostgREST as anon. */
export function rpcUnsubscribe(
  supabaseUrl: string,
  publishableKey: string,
  fetchFn: (input: string, init: RequestInit) => Promise<Response> = fetch,
) {
  return async (token: string): Promise<UnsubscribeOutcome> => {
    const res = await fetchFn(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/email_unsubscribe`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    })
    if (res.ok) return { ok: true, category: String(await res.json()) }
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    return {
      ok: false,
      invalid: body.message === 'invalid_unsubscribe_link',
      message: body.message ?? `HTTP ${res.status}`,
    }
  }
}
