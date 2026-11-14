# 8. Additive migrations and versioned RPCs

- Status: accepted
- Date: 2026-11-05

## Context

The web app updates within minutes of a deploy, but a service worker can keep an old bundle alive for a while, and native apps will lag by weeks because people do not update. Every client calls the database directly, so the schema and RPC signatures are the API. On top of that, the deploy pipeline applies migrations before the new web build goes out, so for a short window the old client runs against the new schema.

## Decision

- Migrations only add things: new tables, new nullable or defaulted columns, new functions, new policies. They do not rename or drop columns, change a column's meaning, or change an RPC's arguments or return shape in place.
- Allowed in place, because no client can tell the difference:
  - widening a column without losing values (`20261106010000_integrity_fixes.sql` took `fx_rate` from `numeric(18,8)` to `numeric(24,12)`);
  - dropping and recreating a view in the same migration with the same columns (the same file does this to `group_balances`, which depends on `fx_rate`);
  - `create or replace` of a function body that keeps its arguments, return shape and error codes. Copy the newest body (see `supabase/schema/current.sql`), not the first migration that defined it.
- When an RPC needs a breaking change, add a new function with a `_v2` suffix and keep the old one working. Remove the old one only after `app_config.min_client_version` has moved every platform past the last client that calls it.
- Nobody edits a migration that has reached `main`. Fixes go in a new migration.
- Never change the database through the dashboard. `supabase db push` from CI is the only writer of schema in production.

## Consequences

- Old clients keep working through a deploy and long after it.
- Rolling back the web app is safe, because the schema it expects is still there (see [deployment.md](../deployment.md#rollback)).
- Old functions and columns pile up. Cleanup needs a planned migration once the minimum client version allows it.
- Some designs get awkward, for example a column kept only for old clients. We take that over breaking someone's app in the middle of a trip.

## Request keys

- Date: 2026-11-14

A save whose reply is lost (the connection drops after the server committed) used to come back
as a second expense or payment when the person pressed Try again. Each expense and payment form
now makes one random id per draft and sends it with every try, and the server keeps it per person
(`private.request_keys`, primary key `(user_id, kind, request_id)`), answering a repeat with the
row the first try made.

How it stays additive:

- `create_expense_v2` and `create_expense_with_attachments` take the key inside their `payload`
  (`request_id`). A new optional key in a JSON payload changes nothing for a client that does not
  send it, so their bodies are redefined in place.
- `settle_up_v2` takes positional arguments, and a new defaulted argument would make a second
  overload that PostgREST cannot tell apart from the first. So the key comes with a new
  `settle_up_v3(..., request_id uuid default null)`, which calls `settle_up_v2`; v2 stays for older
  clients.

The key wins over the payload: a retry with a changed draft would still return the first save.
So the form holds its fields read only while a save is out and after a lost reply, until a try
gets an answer, and reports what the server returned, never its own fields. Details:
[architecture](../architecture.md) (Request keys).
