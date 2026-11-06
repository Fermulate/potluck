// Regenerate packages/api/src/database.types.ts from the local database.
// `--check` fails when the committed file differs (CI db job, `pnpm verify:db`).
import { bin, capture, format, repo, writeOrCheck } from './lib.mjs'

const target = repo('packages/api/src/database.types.ts')
const raw = capture([...bin('supabase'), 'gen', 'types', 'typescript', '--local'])
writeOrCheck(target, await format(raw, target), 'pnpm db:types')
