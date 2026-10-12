# Contributing to Potluck

Thanks for helping out. This guide covers local setup and how changes get merged.

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md). By contributing code you agree that it is licensed under the project's [license](LICENSE) (GNU AGPL-3.0 with an App Store exception).

## Prerequisites

- Node.js 22 (see `.nvmrc`; `nvm use` picks it up)
- pnpm 9 (`corepack enable` or `npm i -g pnpm@9`)
- Docker, for the local Supabase stack

## Setup

```sh
git clone https://github.com/Fermulate/potluck.git
cd potluck
pnpm install
pnpm db:start          # starts local Supabase in Docker, prints URL and keys
cp .env.example .env.local
# fill VITE_SUPABASE_PUBLISHABLE_KEY with the publishable key printed by db:start
pnpm dev               # http://localhost:5173
```

Demo accounts, Windows notes, edge functions and the rest of the local setup are in [docs/development.md](docs/development.md). The full developer docs start at [docs/README.md](docs/README.md).

## Repository layout

| Path              | What lives there                                                         |
| ----------------- | ------------------------------------------------------------------------ |
| `apps/web`        | Vite + React web app (PWA)                                               |
| `packages/core`   | Domain logic (money, splits, balances, scheduling). No DOM, no React DOM |
| `packages/api`    | Supabase client, generated DB types, query helpers. No DOM, no React DOM |
| `packages/tokens` | Design tokens as plain values                                            |
| `packages/i18n`   | Translation strings and `Intl` formatters                                |
| `packages/ui`     | Web-only React components                                                |
| `supabase`        | Config, migrations, seed data and pgTAP tests                            |

`core`, `api`, `tokens` and `i18n` will be shared with a future React Native app, so they must not import `react-dom` or use browser globals. Lint and typecheck enforce this.

## Common commands

| Command          | What it does                                    |
| ---------------- | ----------------------------------------------- |
| `pnpm dev`       | Run the web app                                 |
| `pnpm build`     | Production build                                |
| `pnpm typecheck` | TypeScript across all workspaces                |
| `pnpm lint`      | ESLint                                          |
| `pnpm test`      | Vitest across all workspaces                    |
| `pnpm format`    | Prettier                                        |
| `pnpm db:start`  | Start local Supabase                            |
| `pnpm db:reset`  | Recreate the local DB from migrations + seed    |
| `pnpm db:types`  | Regenerate `packages/api/src/database.types.ts` |
| `pnpm db:test`   | Run pgTAP tests in `supabase/tests`             |

## Branches

Branch off `main` and use a prefix:

- `feat/<short-name>` for new features
- `fix/<short-name>` for bug fixes
- `chore/<short-name>` for tooling, deps, refactors and docs

## Commits

Use short, conventional-ish messages in the imperative: `feat: add expense form`, `fix: round split remainder`, `chore: bump vite`. Keep commits focused; squash noise before opening a PR.

## Pull requests

- Open a PR against `main` and fill in the template.
- CI must pass (typecheck, lint, test, build, database tests).
- Every PR needs an approving review from a code owner (see `.github/CODEOWNERS`).
- Keep PRs small. Split large changes into reviewable steps.

## Database changes

Never edit the database by hand in the Supabase dashboard. All schema changes go through migrations:

1. `npx supabase migration new <name>` and write the SQL in `supabase/migrations/`.
2. `pnpm db:reset` to apply it locally from scratch.
3. Add or update pgTAP tests in `supabase/tests/` (tables, constraints, and especially row level security policies), then run `pnpm db:test`.
4. `pnpm db:types` and commit the regenerated types alongside the migration.

Every table in an exposed schema must have row level security enabled with tests covering who can and cannot read or write it.

## Reporting bugs and security issues

Use the issue templates for bugs and feature requests. Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
