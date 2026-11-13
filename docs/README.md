# Developer docs

Start with [development.md](development.md) to get Potluck running, then read [architecture.md](architecture.md) before you change anything under `supabase/` or `packages/core`.

| Doc                                              | Read it when                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [development.md](development.md)                 | setting up, running the local stack, writing a migration, adding strings or routes            |
| [architecture.md](architecture.md)               | you need the system diagrams, the schema, the RPC list, the security model or the money rules |
| [sequences.md](sequences.md)                     | you want to know what actually happens when someone adds an expense, joins a group or deploys |
| [testing.md](testing.md)                         | writing tests, checking coverage, running pgTAP                                               |
| [deployment.md](deployment.md)                   | configuring CI, setting secrets, rolling back, or running your own copy                       |
| [launch-checklist.md](launch-checklist.md)       | seeing what is live and what still needs credentials or a person                              |
| [security.md](security.md)                       | you touch auth, RLS, storage or edge functions, or want to know what data we keep             |
| [design.md](design.md)                           | building UI: palette, type, motion, accessibility                                             |
| [backup-format.md](backup-format.md)             | reading or writing the JSON backup, the spreadsheet export or an import file                  |
| [splitwise-parity.md](splitwise-parity.md)       | picking the next feature: what Splitwise has that Potluck lacks, cut into parallel batches    |
| [dogfood/performance.md](dogfood/performance.md) | the performance pass: what was measured, what changed and what it bought                      |
| [adr/](adr/README.md)                            | you wonder why something is the way it is                                                     |

Outside this folder: [CONTRIBUTING.md](../CONTRIBUTING.md) (branches, commits, PRs), [SECURITY.md](../SECURITY.md) (reporting vulnerabilities), [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md), and [AGENTS.md](../AGENTS.md) (commands and rules for coding agents, with a nested `AGENTS.md` in `apps/web`, `packages/core`, `packages/api`, `packages/i18n` and `supabase`).

The user guide that the app's help links open lives in its own repository, [Fermulate/potluck-docs](https://github.com/Fermulate/potluck-docs). Anchors in `apps/web/src/features/help/topics.ts` must match its headings, so a change to user-facing behavior often needs a PR there too.

Generated references, checked in CI:

- [`supabase/schema/current.sql`](../supabase/schema/current.sql): the live schema after every migration (`pnpm gen:schema`).
- [`agent-map.json`](agent-map.json): routes, RPCs with arguments, grants and error codes, tables with RLS and policies, error codes with their i18n keys, i18n namespaces, edge functions (`pnpm gen:map`).

## Map of the repository

```
apps/web/              Vite + React PWA, TanStack Router and Query, Tailwind v4
  src/routes/          file-based routes (_app/ is the signed-in shell)
  src/features/        screens and hooks per feature
  wrangler.jsonc       Cloudflare Workers static assets config
packages/core/         split math, balances, debt simplification, slots and heat,
                       recurrence, roles, zod schemas (no DOM)
packages/api/          typed Supabase client, generated DB types, queries (no DOM)
packages/i18n/         strings per feature, t(), money and date formatting (no DOM)
packages/tokens/       design tokens as TypeScript (no DOM)
packages/ui/           web React components
supabase/migrations/   schema, RLS, RPCs, triggers, storage, realtime, cron
supabase/functions/    edge functions: notify, fx-sync, ics-feed, delete-account
supabase/tests/        pgTAP tests
supabase/schema/       generated snapshot of the live schema
supabase/snippets/     local only: perf volume data and explain plans for the hot paths
supabase/seed.sql      demo users and data
scripts/               verify and the generators (plain Node)
.agents/skills/        task recipes for coding agents (copied to .claude/skills)
.github/workflows/     ci, deploy, codeql, keepalive
```

## Keeping these docs true

The code wins. If a doc and a migration disagree, fix the doc in the same PR that changes the code. When you add a table, RPC, bucket, realtime table, cron job or edge function, update [architecture.md](architecture.md). When you add a flow that spans the client, the database and a function, add a diagram to [sequences.md](sequences.md). Diagrams are Mermaid, which GitHub renders in place.
