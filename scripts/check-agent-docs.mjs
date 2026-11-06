// Keeps the agent instructions honest (`pnpm verify`): every AGENTS.md, CLAUDE.md and skill must
// stay inside its size budget, name only pnpm scripts that exist, link only to files that exist,
// mention only repo paths that exist, and contain no em or en dashes.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { repo, root } from './lib.mjs'

const scripts = new Set(Object.keys(JSON.parse(readFileSync(repo('package.json'), 'utf8')).scripts))
// pnpm's own commands, and a script name followed by its flags, are fine.
const PNPM_BUILTINS = new Set([
  'install',
  'exec',
  'add',
  'run',
  'dlx',
  '--filter',
  'turbo',
  'vitest',
])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.turbo', 'worktrees'])

function find(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) find(path, out)
    else if (['AGENTS.md', 'CLAUDE.md', 'SKILL.md', 'copilot-instructions.md'].includes(entry.name))
      out.push(path)
  }
  return out
}

const files = find(root).sort()
const problems = []
const rel = (p) => relative(root, p).replaceAll('\\', '/')

for (const file of files) {
  const name = rel(file)
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n').length
  const budget = name === 'AGENTS.md' ? 200 : 120
  if (lines > budget) problems.push(`${name}: ${lines} lines, budget ${budget}`)
  if (/[–—]/.test(text)) problems.push(`${name}: contains an em or en dash`)

  for (const [, script] of text.matchAll(/`pnpm ([a-z][\w:-]*)/g)) {
    if (!PNPM_BUILTINS.has(script) && !scripts.has(script)) {
      problems.push(`${name}: \`pnpm ${script}\` is not a root package.json script`)
    }
  }
  for (const [, target] of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
    if (/^[a-z]+:/.test(target)) continue
    if (!existsSync(resolve(dirname(file), target))) problems.push(`${name}: broken link ${target}`)
  }
  // Backticked paths that start at a top-level folder of the repo must exist (globs and
  // placeholders such as <name> are skipped).
  for (const [, path] of text.matchAll(
    /`((?:apps|packages|supabase|docs|scripts|\.github|\.agents|\.claude)\/[^`\s]+)`/g,
  )) {
    if (/[<>*{}]/.test(path) || path.startsWith('.claude/worktrees')) continue
    const clean = path.replace(/[:,.]$/, '')
    if (!existsSync(repo(clean))) problems.push(`${name}: mentions missing path ${clean}`)
  }
}

// Codex stops reading the AGENTS.md chain at 32 KiB.
const chain = files.filter((f) => f.endsWith('AGENTS.md'))
const bytes = chain.reduce((sum, f) => sum + statSync(f).size, 0)
if (bytes > 32 * 1024) problems.push(`AGENTS.md files total ${bytes} bytes, over 32 KiB`)

if (problems.length) {
  console.error(problems.join('\n'))
  process.exitCode = 1
} else {
  console.log(`${files.length} agent instruction files ok (${bytes} bytes of AGENTS.md).`)
}
