import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { t } from '@potluck/i18n'
import { describe, expect, it } from 'vitest'
import { errorMessage, type ErrorScope } from './errors'

const root = join(import.meta.dirname, '../../../..')
const migrations = join(root, 'supabase/migrations')
const files = readdirSync(migrations)
  .filter((f) => f.endsWith('.sql'))
  .sort()
const sql = (file: string) => readFileSync(join(migrations, file), 'utf8')

/** Every `raise exception using message = '<code>'` in any migration, old versions included. */
const raised = [
  ...new Set(
    files.flatMap((f) =>
      [...sql(f).matchAll(/message\s*=\s*'([a-z][a-z0-9_]*)'/g)].map((m) => m[1]!),
    ),
  ),
].sort()

const SCOPES: (ErrorScope | undefined)[] = [undefined, 'expenses.errors', 'events.errors']

describe('error codes the database raises', () => {
  it('finds the codes', () => {
    expect(raised).toContain('not_a_member')
    expect(raised.length).toBeGreaterThan(50)
  })

  it('each have a message on some screen, not the generic fallback', () => {
    const generic = t('errors.generic')
    const untranslated = raised.filter((code) =>
      SCOPES.every((scope) => errorMessage({ message: code }, scope) === generic),
    )
    expect(untranslated).toEqual([])
  })

  it('are each listed in the Errors section of docs/architecture.md', () => {
    const doc = readFileSync(join(root, 'docs/architecture.md'), 'utf8')
    const start = doc.indexOf('### Errors')
    const section = doc.slice(start, doc.indexOf('\n### ', start + 1))
    expect(raised.filter((code) => !section.includes(`\`${code}\``))).toEqual([])
  })

  it('use PT404 for not found: migrations after 20261105200000 never raise P0002', () => {
    // P0002 makes PostgREST answer 500. Older files still show it; 20261105200000 rewrote them.
    const offenders = files.filter(
      (f) => f > '20261105200000' && /errcode\s*=\s*'P0002'/.test(sql(f)),
    )
    expect(offenders).toEqual([])
  })
})
