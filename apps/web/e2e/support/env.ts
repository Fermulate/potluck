import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

export interface StackEnv {
  url: string
  publishableKey: string
  serviceRoleKey: string
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!match) continue
    out[match[1]!] = match[2]!.replace(/^"(.*)"$/, '$1')
  }
  return out
}

function readEnvLocal(): Record<string, string> {
  const file = `${repoRoot}.env.local`
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}
}

/**
 * Keys for the local Supabase stack. The URL and publishable key come from `.env.local` (the
 * same file the app is built with); the service role key is read from `supabase status` at run
 * time so it never lands in the repository.
 */
export function resolveStackEnv(): StackEnv {
  const local = readEnvLocal()
  const url = process.env.E2E_SUPABASE_URL ?? local.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
  let publishableKey = process.env.E2E_PUBLISHABLE_KEY ?? local.VITE_SUPABASE_PUBLISHABLE_KEY
  let serviceRoleKey = process.env.E2E_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!serviceRoleKey || !publishableKey) {
    const status = parseEnv(
      execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], {
        cwd: repoRoot,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    )
    serviceRoleKey ??= status.SERVICE_ROLE_KEY ?? status.SECRET_KEY
    publishableKey ??= status.PUBLISHABLE_KEY ?? status.ANON_KEY
  }
  if (!serviceRoleKey || !publishableKey) {
    throw new Error('Could not read the local Supabase keys. Is `supabase start` running?')
  }
  return { url, publishableKey, serviceRoleKey }
}

/** Set by global setup, read by every worker. */
export function stackEnv(): StackEnv {
  const { E2E_SUPABASE_URL, E2E_PUBLISHABLE_KEY, E2E_SERVICE_ROLE_KEY } = process.env
  if (E2E_SUPABASE_URL && E2E_PUBLISHABLE_KEY && E2E_SERVICE_ROLE_KEY) {
    return {
      url: E2E_SUPABASE_URL,
      publishableKey: E2E_PUBLISHABLE_KEY,
      serviceRoleKey: E2E_SERVICE_ROLE_KEY,
    }
  }
  return resolveStackEnv()
}
