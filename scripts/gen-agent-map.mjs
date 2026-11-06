// Build docs/agent-map.json: an index of routes, RPCs, tables, error codes, i18n namespaces
// and edge functions, derived only from committed sources of truth:
//   apps/web/src/routeTree.gen.ts, supabase/schema/current.sql, supabase/migrations,
//   packages/i18n/src/en.ts, supabase/config.toml and supabase/functions.
// No database needed. `--check` fails when the committed map differs (`pnpm verify`).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { format, repo, writeOrCheck } from './lib.mjs'

const read = (path) => readFileSync(repo(path), 'utf8').replace(/\r\n/g, '\n')
const sortBy = (key) => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0)

// ---------- routes ----------
function routes() {
  const tree = read('apps/web/src/routeTree.gen.ts')
  const files = Object.fromEntries(
    [...tree.matchAll(/import \{ Route as (\w+)Import \} from '\.\/(routes\/[^']+)'/g)].map(
      ([, name, file]) => [name, `apps/web/src/${file}.tsx`],
    ),
  )
  const block = (name) => tree.match(new RegExp(`export interface ${name} \\{([^}]*)\\}`))[1]
  const entries = (name) =>
    [...block(name).matchAll(/^\s+'([^']+)': typeof (\w+)/gm)].map(([, key, ref]) => [
      key,
      ref.replace(/WithChildren$/, ''),
    ])
  const pathOf = Object.fromEntries(entries('FileRoutesByFullPath').map(([p, ref]) => [ref, p]))
  return entries('FileRoutesById')
    .map(([id, ref]) => ({
      id,
      path: pathOf[ref] ?? null,
      file: files[ref] ?? null,
      signedIn: id === '/_app' || id.startsWith('/_app/'),
    }))
    .sort(sortBy('id'))
}

// ---------- schema snapshot ----------
const schema = read('supabase/schema/current.sql')
const unquote = (s) => s.replace(/"/g, '')

/** Text inside the parenthesis that opens at `start`. */
function balanced(text, start) {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return text.slice(start + 1, i)
  }
  throw new Error('unbalanced parenthesis')
}

/** Every `raise exception using message = '<code>' ... errcode = '<state>'` in a body. */
function raised(body) {
  return [...body.matchAll(/raise\s+exception\s+using\s+([\s\S]*?);/gi)]
    .map(([, using]) => ({
      code: using.match(/message\s*=\s*'([a-z0-9_]+)'/i)?.[1],
      state: using.match(/errcode\s*=\s*'([A-Z0-9]+)'/i)?.[1] ?? null,
    }))
    .filter((r) => r.code)
}

/** The last migration whose source defines `schema.name`, i.e. the body to copy. */
const migrationFiles = readdirSync(repo('supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
const migrationText = Object.fromEntries(
  migrationFiles.map((f) => [f, read(`supabase/migrations/${f}`)]),
)
function lastDefinedIn(schemaName, name) {
  const pattern = new RegExp(
    `create\\s+(or\\s+replace\\s+)?function\\s+${schemaName}\\.${name}\\s*\\(`,
    'i',
  )
  const hits = migrationFiles.filter((f) => pattern.test(migrationText[f]))
  return hits.length ? `supabase/migrations/${hits.at(-1)}` : null
}

function functions() {
  const out = []
  const header = /^CREATE OR REPLACE FUNCTION "(public|private)"\."(\w+)"\(/gm
  for (const m of schema.matchAll(header)) {
    const [, schemaName, name] = m
    const open = m.index + m[0].length - 1
    const args = balanced(schema, open)
    const afterArgs = schema.slice(open + args.length + 2)
    const returns = afterArgs.match(/^\s*RETURNS ([^\n]+)/)?.[1].trim() ?? null
    const tag = afterArgs.match(/AS (\$\w*\$)/)?.[1]
    const bodyStart = afterArgs.indexOf(tag) + tag.length
    const body = afterArgs.slice(bodyStart, afterArgs.indexOf(tag, bodyStart))
    const attrs = afterArgs.slice(0, afterArgs.indexOf(tag))
    const line = schema.slice(0, m.index).split('\n').length
    // ACL lines name the argument types only, so match them by name and argument list.
    const aclArgs = args.replace(/\s+DEFAULT [^,]+(?=,|$)/g, '')
    const acl = (verb) =>
      [
        ...schema.matchAll(
          new RegExp(
            `^${verb} ALL ON FUNCTION "${schemaName}"\\."${name}"\\((.*)\\) (?:TO|FROM) ("?[\\w]+"?);$`,
            'gm',
          ),
        ),
      ]
        .filter(([, a]) => a === aclArgs)
        .map(([, , role]) => unquote(role))
    const revoked = acl('REVOKE')
    const granted = acl('GRANT')
    const execute = [...new Set([...(revoked.includes('PUBLIC') ? [] : ['PUBLIC']), ...granted])]
    out.push({
      name: `${schemaName}.${name}`,
      args: unquote(args),
      returns: unquote(returns ?? ''),
      securityDefiner: /SECURITY DEFINER/.test(attrs),
      execute: execute.sort(),
      raises: [...new Set(raised(body).map((r) => r.code))].sort(),
      snapshotLine: line,
      definedIn: lastDefinedIn(schemaName, name),
    })
  }
  return out.sort(sortBy('name'))
}

function tables() {
  const realtime = new Set(
    [
      ...schema.matchAll(
        /^ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"\."(\w+)";$/gm,
      ),
    ].map(([, t]) => t),
  )
  const names = [
    ...schema.matchAll(/^CREATE TABLE IF NOT EXISTS "(public|private)"\."(\w+)" \(/gm),
  ].map(([, s, t]) => [s, t])
  const views = [...schema.matchAll(/^CREATE OR REPLACE VIEW "public"\."(\w+)"/gm)].map(([, v]) => [
    'public',
    v,
  ])
  return [...names, ...views]
    .map(([s, t]) => {
      const q = `"${s}"\\."${t}"`
      const policies = [
        ...schema.matchAll(
          new RegExp(
            `^CREATE POLICY "([^"]+)" ON ${q}(?: AS (\\w+))?(?: FOR (\\w+))?(?: TO ([^\\n]+?))?(?: USING| WITH CHECK|;)`,
            'gm',
          ),
        ),
      ].map(([, policy, , command = 'ALL', roles = 'PUBLIC']) => ({
        name: policy,
        command,
        roles: roles.split(',').map((r) => unquote(r.trim())),
      }))
      const grants = {}
      for (const [, privilege, role] of schema.matchAll(
        new RegExp(`^GRANT (.+?) ON TABLE ${q} TO "(anon|authenticated)";$`, 'gm'),
      )) {
        ;(grants[role] ??= []).push(unquote(privilege))
      }
      const isView = views.some(([vs, v]) => vs === s && v === t)
      return {
        name: `${s}.${t}`,
        kind: isView ? 'view' : 'table',
        // Views have no RLS of their own; group_balances is security_invoker, so the caller's
        // policies on the underlying tables apply.
        rls: isView
          ? 'security_invoker'
          : new RegExp(`^ALTER TABLE ${q} ENABLE ROW LEVEL SECURITY;$`, 'm').test(schema),
        realtime: s === 'public' && realtime.has(t),
        clientGrants: grants,
        policies: policies.sort(sortBy('name')),
      }
    })
    .sort(sortBy('name'))
}

// ---------- i18n ----------
// The dictionary is TypeScript with extensionless imports; let Node strip the types and find the
// `.ts` files.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.\w+$/.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context)
      } catch {
        // fall through
      }
    }
    return next(specifier, context)
  },
})
const { en } = await import(pathToFileURL(repo('packages/i18n/src/en.ts')).href)
const hasKey = (key) =>
  typeof key.split('.').reduce((node, part) => (node == null ? node : node[part]), en) === 'string'

function namespaces() {
  const source = read('packages/i18n/src/en.ts')
  const fileOf = {}
  for (const [, names, file] of source.matchAll(/import \{([^}]+)\} from '\.\/(en\/\w+)'/g)) {
    for (const n of names.split(',')) fileOf[n.trim()] = `packages/i18n/src/${file}.ts`
  }
  return Object.keys(en)
    .map((name) => ({ name, file: fileOf[name] ?? null }))
    .sort(sortBy('name'))
}

/** Lookup order in apps/web/src/lib/errors.ts: the screen scope, then errors.codes. */
const ERROR_SCOPES = ['expenses.errors', 'events.errors', 'errors.codes']

function errorCodes() {
  const codes = new Map()
  for (const m of schema.matchAll(/^CREATE OR REPLACE FUNCTION "(public|private)"\."(\w+)"\(/gm)) {
    const start = m.index
    const end = schema.indexOf('\nALTER FUNCTION', start)
    for (const { code, state } of raised(schema.slice(start, end))) {
      const entry = codes.get(code) ?? { code, sqlstates: new Set(), raisedBy: new Set() }
      if (state) entry.sqlstates.add(state)
      entry.raisedBy.add(`${m[1]}.${m[2]}`)
      codes.set(code, entry)
    }
  }
  return [...codes.values()]
    .map((e) => ({
      code: e.code,
      sqlstates: [...e.sqlstates].sort(),
      raisedBy: [...e.raisedBy].sort(),
      i18n: ERROR_SCOPES.map((scope) => `${scope}.${e.code}`).filter(hasKey),
    }))
    .sort(sortBy('code'))
}

// ---------- edge functions ----------
function edgeFunctions() {
  const config = read('supabase/config.toml')
  return readdirSync(repo('supabase/functions'))
    .filter((d) => !d.startsWith('_') && statSync(repo('supabase/functions', d)).isDirectory())
    .map((name) => ({
      name,
      dir: `supabase/functions/${name}`,
      verifyJwt:
        config.match(
          new RegExp(`\\[functions\\.${name}\\]\\s*\\nverify_jwt = (true|false)`),
        )?.[1] === 'true',
    }))
    .sort(sortBy('name'))
}

const fns = functions()
const map = {
  $comment:
    'Generated by `pnpm gen:map`. Do not edit. Functions and tables come from supabase/schema/current.sql (snapshotLine is the line there); definedIn is the newest migration that redefines the function.',
  routes: routes(),
  rpcs: fns.filter((f) => f.name.startsWith('public.')),
  privateFunctions: fns.filter((f) => f.name.startsWith('private.')),
  tables: tables(),
  errorCodes: errorCodes(),
  errorScopes: ERROR_SCOPES,
  i18nNamespaces: namespaces(),
  edgeFunctions: edgeFunctions(),
}

const target = repo('docs/agent-map.json')
writeOrCheck(target, await format(JSON.stringify(map), target), 'pnpm gen:map')
