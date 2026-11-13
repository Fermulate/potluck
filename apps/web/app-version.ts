import { execFileSync } from 'node:child_process'

/** The short commit being built: from CI when it says, else from the checkout, else "dev". */
function commit(): string {
  const fromCi =
    process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.CF_PAGES_COMMIT_SHA
  if (fromCi) return fromCi.slice(0, 7)
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'dev'
  }
}

/** Shown on Me as "Version 2026.11.13 (3305a99)", so a bug report names the exact build. */
export function appVersion(now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10).replaceAll('-', '.')
  return `${day} (${commit()})`
}
