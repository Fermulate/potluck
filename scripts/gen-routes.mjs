// Regenerate apps/web/src/routeTree.gen.ts without starting Vite (`tsr generate`, the same
// generator the router plugin runs during `pnpm dev` and `pnpm build`).
// `--check` fails when the committed file differs and leaves it untouched.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { capture, repo } from './lib.mjs'

const web = repo('apps/web')
const target = join(web, 'src/routeTree.gen.ts')
const require = createRequire(join(web, 'package.json'))
const cli = join(dirname(require.resolve('@tanstack/router-cli/package.json')), 'bin/tsr.cjs')

const before = readFileSync(target, 'utf8')
capture([process.execPath, cli, 'generate'], { cwd: web })
const after = readFileSync(target, 'utf8')

if (process.argv.includes('--check')) {
  if (after !== before) {
    writeFileSync(target, before)
    console.error(
      'apps/web/src/routeTree.gen.ts is out of date. Run `pnpm gen:routes` and commit it.',
    )
    process.exitCode = 1
  } else {
    console.log('apps/web/src/routeTree.gen.ts is up to date.')
  }
} else {
  console.log(
    after === before ? 'routeTree.gen.ts unchanged.' : 'wrote apps/web/src/routeTree.gen.ts',
  )
}
