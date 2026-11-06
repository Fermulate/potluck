// One pass/fail entry point with the same checks as CI.
//
//   pnpm verify              ci.yml "check" job: format, lint, generated files, agent docs, typecheck,
//                            unit tests with coverage, edge function tests, production build
//   pnpm verify:db           ci.yml "db" job: db lint, pgTAP, schema snapshot, database types
//                            (needs the local stack, reset to this branch: `pnpm db:reset`)
//
// Flags: --concurrency=N is passed to turbo (use 1 on a small machine), --only=a,b runs just
// those steps, --list prints the steps. Stops at the first failing step.
import { spawnSync } from 'node:child_process'
import { root } from './lib.mjs'

const args = process.argv.slice(2)
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const db = args.includes('--db')
const concurrency = flag('concurrency')
const turbo = (task) =>
  `pnpm turbo run ${task}${concurrency ? ` --concurrency=${concurrency}` : ''}`

// Production builds refuse to run without these (apps/web/require-env.ts). CI uses the same
// placeholders; they are enough to compile.
const BUILD_ENV = {
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'ci-build-placeholder',
  VITE_APP_URL: 'http://localhost:4173',
}

const checkSteps = [
  ['format', 'pnpm exec prettier --check .'],
  ['lint', 'pnpm lint'],
  ['routes', 'node scripts/gen-routes.mjs --check'],
  ['agent-map', 'node scripts/gen-agent-map.mjs --check'],
  ['skills', 'node scripts/sync-skills.mjs --check'],
  ['agent-docs', 'node scripts/check-agent-docs.mjs'],
  ['typecheck', turbo('typecheck')],
  ['test', turbo('test:coverage')],
  ['functions', 'pnpm test:functions'],
  ['build', turbo('build'), BUILD_ENV],
]

const dbSteps = [
  ['db-lint', 'pnpm exec supabase db lint --fail-on error'],
  ['pgtap', 'pnpm exec supabase test db'],
  ['schema', 'node scripts/gen-schema.mjs --check'],
  ['types', 'node scripts/gen-db-types.mjs --check'],
]

let steps = db ? dbSteps : checkSteps
if (args.includes('--list')) {
  for (const [name, command] of steps) console.log(`${name.padEnd(10)} ${command}`)
  process.exit(0)
}
const only = flag('only')?.split(',')
if (only) steps = steps.filter(([name]) => only.includes(name))

const gha = !!process.env.GITHUB_ACTIONS
const results = []
for (const [name, command, env] of steps) {
  console.log(gha ? `::group::${name}: ${command}` : `\n> ${name}: ${command}`)
  const started = Date.now()
  const { status } = spawnSync(command, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env },
  })
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  if (gha) console.log('::endgroup::')
  results.push(`${status === 0 ? 'ok  ' : 'FAIL'} ${name} (${seconds}s)`)
  if (status !== 0) {
    console.error(`\n${results.join('\n')}\n\n${name} failed: ${command}`)
    process.exit(status ?? 1)
  }
}
console.log(`\n${results.join('\n')}\n\nverify${db ? ':db' : ''} passed`)
