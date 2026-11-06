// Project skills live once, in .agents/skills/<name>/ (read by Codex, Cursor, Copilot and
// Gemini CLI). Claude Code reads only .claude/skills/, so this copies them there. Copies, not
// symlinks: Git on Windows checks symlinks out as plain text files.
// `--check` fails when .claude/skills differs from .agents/skills (`pnpm verify`).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { repo } from './lib.mjs'

const source = repo('.agents/skills')
const target = repo('.claude/skills')
const check = process.argv.includes('--check')

function files(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).replaceAll('\\', '/'))
    .sort()
}

const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const wanted = files(source)
const present = files(target)
const problems = []

for (const file of wanted) {
  const want = read(join(source, file))
  const have = existsSync(join(target, file)) ? read(join(target, file)) : null
  if (have === want) continue
  problems.push(have === null ? `missing .claude/skills/${file}` : `stale .claude/skills/${file}`)
  if (!check) {
    mkdirSync(dirname(join(target, file)), { recursive: true })
    writeFileSync(join(target, file), want)
  }
}
for (const file of present.filter((f) => !wanted.includes(f))) {
  problems.push(`extra .claude/skills/${file} (not in .agents/skills)`)
  if (!check) rmSync(join(target, file))
}

if (check && problems.length) {
  console.error(
    `${problems.join('\n')}\n\nEdit skills in .agents/skills, then run \`pnpm gen:skills\`.`,
  )
  process.exitCode = 1
} else if (check) {
  console.log(`.claude/skills matches .agents/skills (${wanted.length} files).`)
} else {
  console.log(problems.length ? problems.join('\n') : '.claude/skills already in sync.')
}
