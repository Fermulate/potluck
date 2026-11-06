// Shared helpers for the repo scripts. Plain Node, no shell, so they run the same on Windows,
// macOS and Linux.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(join(root, 'package.json'))

/** Absolute path inside the repo. */
export const repo = (...parts) => join(root, ...parts)

/** `[command, ...args]` that runs a dev dependency's CLI through the current Node. */
export function bin(name) {
  const scripts = {
    supabase: 'supabase/dist/supabase.js',
    prettier: 'prettier/bin/prettier.cjs',
    eslint: 'eslint/bin/eslint.js',
  }
  return [process.execPath, require.resolve(scripts[name])]
}

/** Run a command, capture stdout, and throw with its stderr when it fails. */
export function capture(argv, options = {}) {
  const [cmd, ...args] = argv
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || String(result.error ?? '')).trim()
    throw new Error(`${argv.slice(0, 3).join(' ')} failed:\n${message}`)
  }
  return result.stdout
}

/** Format text with the repo's Prettier config, as if it were the file at `path`. */
export async function format(text, path) {
  const mod = await import(pathToFileURL(require.resolve('prettier')).href)
  const prettier = mod.default ?? mod
  const config = (await prettier.resolveConfig(path)) ?? {}
  return prettier.format(text, { ...config, filepath: path })
}

/**
 * Write a generated file, or with `--check` compare it and fail when it is stale.
 * `regen` is the command a person runs to fix it.
 */
export function writeOrCheck(path, content, regen) {
  const check = process.argv.includes('--check')
  const name = relative(root, path).replaceAll('\\', '/')
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (check) {
    if (current !== content) {
      console.error(`${name} is out of date. Run \`${regen}\` and commit the result.`)
      process.exitCode = 1
    } else {
      console.log(`${name} is up to date.`)
    }
    return
  }
  if (current === content) {
    console.log(`${name} unchanged.`)
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  console.log(`wrote ${name}`)
}
