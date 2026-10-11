# 8. Additive migrations and versioned RPCs

- Status: accepted
- Date: 2026-11-05

## Context

The web app updates within minutes of a deploy, but a service worker can keep an old bundle alive for a while, and native apps will lag by weeks because people do not update. Every client calls the database directly, so the schema and RPC signatures are the API. On top of that, the deploy pipeline applies migrations before the new web build goes out, so for a short window the old client runs against the new schema.

## Decision

- Migrations only add things: new tables, new nullable or defaulted columns, new functions, new policies. They do not rename or drop columns, change a column's meaning, or change an RPC's arguments or return shape in place.
- When an RPC needs a breaking change, add a new function with a `_v2` suffix and keep the old one working. Remove the old one only after `app_config.min_client_version` has moved every platform past the last client that calls it.
- Nobody edits a migration that has reached `main`. Fixes go in a new migration.
- Never change the database through the dashboard. `supabase db push` from CI is the only writer of schema in production.

## Consequences

- Old clients keep working through a deploy and long after it.
- Rolling back the web app is safe, because the schema it expects is still there (see [deployment.md](../deployment.md#rollback)).
- Old functions and columns pile up. Cleanup needs a planned migration once the minimum client version allows it.
- Some designs get awkward, for example a column kept only for old clients. We take that over breaking someone's app in the middle of a trip.
