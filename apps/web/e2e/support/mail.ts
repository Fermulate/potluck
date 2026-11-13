import { execFileSync } from 'node:child_process'
import { repoRoot } from './env'

let cached: string | null = null

/** The local stack's mail catcher (Mailpit), from `E2E_MAIL_URL` or `supabase status`. */
function mailUrl(): string {
  if (cached) return cached
  const fromEnv = process.env.E2E_MAIL_URL
  if (fromEnv) return (cached = fromEnv)
  const status = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const match = /^(?:MAILPIT_URL|INBUCKET_URL)="?([^"\r\n]+)"?/m.exec(status)
  if (!match) throw new Error('No mail catcher in `supabase status`. Is the stack running?')
  return (cached = match[1]!)
}

interface MailpitSummary {
  ID: string
  Subject: string
}

/** Every message sent to `address` so far, newest first, as plain text plus HTML. */
export async function inbox(address: string): Promise<{ subject: string; body: string }[]> {
  const base = mailUrl()
  const search = await fetch(
    `${base}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`,
  ).then((r) => r.json() as Promise<{ messages: MailpitSummary[] | null }>)
  return Promise.all(
    (search.messages ?? []).map(async (m) => {
      const full = (await fetch(`${base}/api/v1/message/${m.ID}`).then((r) => r.json())) as {
        Text: string
        HTML: string
      }
      return { subject: m.Subject, body: `${full.Text}\n${full.HTML}` }
    }),
  )
}

/** The first Supabase verify link in the newest message to `address`, waiting for it to land. */
export async function verifyLink(address: string, timeout = 20_000): Promise<string> {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    for (const message of await inbox(address)) {
      const link = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/.exec(message.body)?.[0]
      if (link) return link.replaceAll('&amp;', '&')
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`No verify link reached ${address}`)
}

/**
 * Opens a verify link the way a mail client would, but lands on `appOrigin`: Supabase sends
 * people to its `site_url` when the link's redirect is not on its allow list, and the test
 * server may run on another port.
 */
export async function landingFor(link: string, appOrigin: string): Promise<string> {
  const response = await fetch(link, { redirect: 'manual' })
  const location = response.headers.get('location')
  if (!location) throw new Error(`Verify link did not redirect (${response.status})`)
  const target = new URL(location)
  const app = new URL(appOrigin)
  target.protocol = app.protocol
  target.host = app.host
  if (target.pathname === '/') target.pathname = '/auth/callback'
  return target.toString()
}
