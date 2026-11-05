# 2. Supabase as the whole backend, RLS as authorization

- Status: accepted
- Date: 2026-11-05

## Context

Potluck is free software run by a small team with no budget for servers. It needs auth, a relational database (money is relational), file uploads, live updates for the availability grid, scheduled jobs and push. Writing and hosting an API server for that would be most of the work and most of the bill.

## Decision

Use one Supabase project for everything: Auth, Postgres, PostgREST, Realtime, Storage, Edge Functions, pg_cron, pg_net and Vault. There is no application server. Clients call PostgREST with the publishable key and the user's JWT.

Authorization lives in Postgres:

- Every table in `public` has RLS enabled, and grants are revoked by default and handed back per column.
- Policy helpers live in the `private` schema, which PostgREST does not expose.
- Every policy is covered by pgTAP tests in `supabase/tests`.
- Realtime and Storage reuse the same rules: Realtime filters changes through the subscriber's select policies, and storage policies call the same `private` helpers.

## Consequences

- No server to run, patch or pay for. The free tier covers the current load.
- One place to audit. A rule written in SQL applies to the web app, the future native app and anyone poking the API with curl.
- Policy mistakes are security bugs, so pgTAP coverage for RLS is not optional (see [testing.md](../testing.md)).
- Business logic that spans rows has to be written in PL/pgSQL. That is a smaller hiring pool than TypeScript, and harder to debug.
- Free projects pause when idle. `keepalive.yml` pings the REST API daily.
- Moving off Supabase would mean rebuilding auth, storage and realtime. The schema and RPCs are plain Postgres and would carry over.
