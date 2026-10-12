# Potluck

Free, open source expense splitting and group event planning. Track who paid for what, settle up in as few payments as possible, and find a time that works for everyone.

Live at https://potluck.potluck-web.workers.dev. Early development: expect rough edges.

## Features

**Money**

- Groups with owner, admin and member roles, joined through invite links (expiry, use limits, optional email binding)
- 1:1 expenses with friends outside any group
- Five ways to split: equal, exact amounts, percentages, shares, and itemized
- Exact to the cent: integer minor units, the same rounding rules on the client and the server
- Multi-currency expenses, converted with daily ECB reference rates
- Recurring expenses (weekly, monthly, yearly) created automatically
- Receipt photos, comments, and an activity feed per group
- Simplified debts: the fewest payments that clear the group

**Plans**

- Availability polls over a date window, painted on a grid in your own time zone
- Live heatmap as friends fill it in
- Ranked best times, with who can and cannot make each one
- Lock in a time, RSVP, and get reminders the day before
- Personal calendar feed (`.ics`) for every plan you are part of

**Everywhere**

- Installable PWA with web push notifications
- Light and dark themes
- No ads, no tracking

## Quickstart

Needs Node 22, pnpm 9 and Docker.

```sh
git clone https://github.com/Fermulate/potluck.git
cd potluck
pnpm install
pnpm db:start               # local Supabase, with demo data
cp .env.example .env.local  # paste the publishable key printed by db:start
pnpm dev                    # http://localhost:5173
```

Sign in as `ava@potluck.test` with password `potluck-demo`. Details, Windows notes and the other demo accounts are in [docs/development.md](docs/development.md).

## How it works

A static React app on Cloudflare talks straight to Supabase. Postgres row level security and a set of database functions are the whole backend; there is no API server. Shared packages hold the money and scheduling logic so a future Expo app can reuse them.

```
apps/web          Vite + React PWA
packages/core     split math, balances, scheduling (no DOM)
packages/api      typed Supabase client
packages/i18n     strings and formatting
packages/tokens   design tokens
packages/ui       web components
supabase/         migrations, RLS, edge functions, pgTAP tests
```

## Docs

- [Developer docs index](docs/README.md)
- [Architecture](docs/architecture.md) and [sequence diagrams](docs/sequences.md)
- [Development](docs/development.md), [testing](docs/testing.md), [deployment and self-hosting](docs/deployment.md)
- [Security](docs/security.md) and [decision records](docs/adr/README.md)
- [Contributing](CONTRIBUTING.md), [reporting a vulnerability](SECURITY.md)

## License

[GNU AGPL-3.0](LICENSE), with an additional permission that allows distribution through mobile app stores as long as the source stays available under the AGPL. If you run a modified Potluck for other people, you have to offer them your source.
