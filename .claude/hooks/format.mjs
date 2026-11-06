// PostToolUse hook for Edit|Write: format the edited file with the repo's Prettier config (same
// ignores as `prettier --check .`), and refresh the .claude/skills copy after a skill edit.
// Never fails the tool call: formatting problems surface in `pnpm verify`.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}')
  const target = input.tool_input?.file_path
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
  if (target) {
    const file = isAbsolute(target) ? target : resolve(input.cwd ?? root, target)
    const path = relative(root, file).split('\\').join('/')
    if (!path.startsWith('../')) {
      const require = createRequire(join(root, 'package.json'))
      const mod = await import(pathToFileURL(require.resolve('prettier')).href)
      const prettier = mod.default ?? mod
      const info = await prettier.getFileInfo(file, {
        ignorePath: [join(root, '.gitignore'), join(root, '.prettierignore')],
        resolveConfig: true,
      })
      if (!info.ignored && info.inferredParser) {
        const source = readFileSync(file, 'utf8')
        const config = (await prettier.resolveConfig(file)) ?? {}
        const formatted = await prettier.format(source, { ...config, filepath: file })
        if (formatted !== source) writeFileSync(file, formatted)
      }
      if (path.startsWith('.agents/skills/')) {
        spawnSync(process.execPath, [join(root, 'scripts/sync-skills.mjs')], { cwd: root })
      }
    }
  }
} catch (error) {
  process.stderr.write(`format hook skipped: ${error?.message ?? error}\n`)
}
process.exit(0)
