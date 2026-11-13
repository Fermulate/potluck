# 11. Notification settings per category, email from the database

- Status: accepted
- Date: 2026-11-13

## Context

Every notification went to the inbox and to every web push device, with one on/off switch per device. Splitwise lets people choose, per kind of event, whether they get a push and whether they get an email, sends a monthly summary, and puts a one-click unsubscribe in every email. Potluck has no email sender yet (no domain or provider), several branches are adding notification types at the same time, and the backend is Postgres plus a few edge functions with no queue service.

## Decision

- **Settings are per category, not per type.** `private.notification_categories` holds one row per setting people see (new expenses, edits and deletions, payments, comments, groups, plans, reminders, monthly summary) with its push and email defaults and which channels it supports. `private.notification_types` maps each notification type to a category. A new type is one insert there; a type with no row is pushed and never emailed, so forgetting the row is noisy rather than silent.
- **Only changes are stored.** `public.notification_prefs (user_id, category, push, email)` keeps what someone switched; null means the default, so changing a default later reaches everyone who never touched it. Clients read with `my_notification_prefs()` and write with `set_notification_pref()`; there are no direct writes.
- **The inbox always gets everything.** A before insert trigger on `notifications` stores the routing decision in `notifications.channels` (`push`, `email`). The existing push hook only calls `notify` when `push` is in it. The decision is recorded so tests, and later the UI, can see it.
- **Email is a flag plus a sender.** `app_config.email_notifications` starts false, and while it is false nothing is routed to email. Turning email on is configuration only: set `RESEND_API_KEY` and `EMAIL_FROM` on the functions, then flip the flag. The sender sits behind a small interface in `supabase/functions/notify/sender.ts`, so another provider is one more branch.
- **Email leaves through an outbox and a cron job.** Rows routed to email go into `private.email_outbox`. The `email-notifications` job runs every minute, waits until nothing new has arrived for the same subject for 60 seconds, folds changes to one expense into a single email (nothing at all if it was added and deleted inside the hold), re-checks the person's settings, enriches the payload with names and current amounts, and posts the batch to `notify`. Rows are marked handled before the call, so an email is sent at most once.
- **Unsubscribe links are signed in the database.** The token is `<user id>.<category or all>.<HMAC>` with a key generated into `private.signing_keys` by the migration; it never leaves Postgres. `public.email_unsubscribe(token, subscribe)` is anon-callable: the token is the credential. The web page `/unsubscribe` applies it when opened and offers undo; the `unsubscribe` edge function answers RFC 8058 one-click POSTs by calling the same RPC with the publishable key. A GET to the function changes nothing.
- **The monthly summary is a notification.** On the first of the month `monthly-summary` writes one `summary.monthly` notification per person with a non-zero balance, built by `private.monthly_summary(uid, month)`. It is an inbox card, never a push, and an email when email is on.

## Consequences

- New types from other branches (`payment.*`, `debt.reminder`, `recurring.upcoming`) are pre-mapped, so they follow the right setting when they land. Anything else needs its row, a `describe.ts` case, push copy in `message.ts` and, optionally, email copy in `email.ts` (unknown types get a generic email).
- Settings are account-wide. The per-device push switch still decides whether a device is subscribed at all.
- Email copy lives in the edge function in English, like push copy; it does not go through `packages/i18n`.
- A second anon-callable RPC widens the public surface. It only ever changes the email settings of the person the token was signed for, and a bad token raises `invalid_unsubscribe_link`.
- The every-minute job writes a `cron.job_run_details` row per run even while email is off.
- Rotating the signing key (delete the row and insert a new one) breaks every unsubscribe link already sent, which is acceptable for a leak but should not be done casually.
