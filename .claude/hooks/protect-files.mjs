// PreToolUse hook for Edit|Write|NotebookEdit. Blocks (exit 2) edits that would be overwritten or
// that break the migration rules, and tells the agent what to run instead.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

const GENERATED = [
  ['apps/web/src/routeTree.gen.ts', 'pnpm gen:routes'],
  ['packages/api/src/database.types.ts', 'pnpm db:types (after pnpm db:reset)'],
  ['supabase/schema/current.sql', 'pnpm gen:schema (after pnpm db:reset)'],
  ['docs/agent-map.json', 'pnpm gen:map'],
]

let input = {}
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}')
} catch {
  process.exit(0)
}
const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path
if (!target) process.exit(0)

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
const path = relative(root, isAbsolute(target) ? target : resolve(input.cwd ?? root, target))
  .split('\\')
  .join('/')
if (path.startsWith('../')) process.exit(0)

function block(reason) {
  process.stderr.write(`${reason}\n`)
  process.exit(2)
}

for (const [file, command] of GENERATED) {
  if (path === file) block(`${file} is generated. Do not edit it; run \`${command}\`.`)
}

if (path.startsWith('.claude/skills/')) {
  block(
    `.claude/skills is a copy. Edit ${path.replace('.claude/', '.agents/')} instead, then run \`pnpm gen:skills\`.`,
  )
}

// A migration that is already on main is immutable (ADR 8): write a new one.
if (/^supabase\/migrations\/[^/]+\.sql$/.test(path) && existsSync(resolve(root, path))) {
  for (const ref of ['origin/main', 'main']) {
    const r = spawnSync('git', ['cat-file', '-e', `${ref}:${path}`], { cwd: root, timeout: 3000 })
    if (r.status === 0) {
      block(
        `${path} is already on ${ref}; migrations on main are never edited. ` +
          'Create a new one with `pnpm exec supabase migration new <name>` and copy the live body ' +
          'from supabase/schema/current.sql.',
      )
    }
  }
}
process.exit(0)
