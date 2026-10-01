# Architecture

Potluck is a static web app (installable PWA) backed entirely by Supabase. There is no application server: the client talks to Supabase directly and Postgres Row Level Security is the authorization layer.

```
apps/web  ──supabase-js──▶  Supabase (Auth · Postgres+RLS · Realtime · Storage · Edge Functions · pg_cron)
   │
Cloudflare Pages (static hosting)
```

A native app (Expo) is planned. Everything below the screens is shared:

| Package           | Purpose                                                                     | Platform     |
| ----------------- | --------------------------------------------------------------------------- | ------------ |
| `packages/core`   | split math, rounding, debt simplification, slot ranking, validation schemas | any (no DOM) |
| `packages/api`    | typed Supabase client, generated DB types, TanStack Query hooks             | any (no DOM) |
| `packages/tokens` | design tokens as TS                                                         | any          |
| `packages/i18n`   | strings, money/date formatting via `Intl`                                   | any          |
| `packages/ui`     | web React components                                                        | web          |
| `apps/web`        | web screens and routing                                                     | web          |

## Ground rules

- Money is stored as integer minor units (`bigint` cents). Never floats.
- Every multi-row write (expense + splits, settle up, accept invite, lock event) goes through a `security definer` RPC that re-checks membership, so it is atomic and the same for every client.
- Timestamps are `timestamptz` (UTC). Clients render in the viewer's timezone (`profiles.timezone`).
- Migrations are additive. Native clients lag behind, so an RPC that needs a breaking change gets a `_v2` name instead.
- RLS is on for every table in `public`. Every policy has pgTAP coverage in `supabase/tests/`.
- Views use `security_invoker = true`.
- Helper functions used inside policies are `security definer`, `stable`, `set search_path = ''`, and live in a `private` schema so they are not exposed over the API.

## Schema (public)

### Enums

- `group_role`: `owner`, `admin`, `member`
- `split_type`: `equal`, `exact`, `percent`, `shares`, `itemized`
- `event_status`: `polling`, `scheduled`, `cancelled`, `done`
- `availability_level`: `yes`, `maybe`
- `rsvp_status`: `going`, `maybe`, `declined`
- `push_platform`: `web`, `ios`, `android`
- `recurrence`: `weekly`, `monthly`, `yearly`

### Identity and social

- `profiles`: `id uuid pk → auth.users on delete cascade`, `display_name text not null`, `avatar_path text`, `timezone text default 'UTC'`, `default_currency char(3) default 'USD'`, `locale text default 'en'`, `deleted_at timestamptz`, timestamps. Created by trigger on `auth.users` insert.
- `friendships`: `(user_id, friend_id)` pk, `created_at`. Stored both directions. Created when two users share a group or by accepting a friend invite.
- `blocks`: `(blocker_id, blocked_id)` pk.
- `reports`: `id`, `reporter_id`, `subject_user_id?`, `group_id?`, `reason text`, `created_at`.

### Groups

- `groups`: `id`, `name text not null`, `emoji text`, `color text`, `cover_path text`, `currency char(3) not null default 'USD'`, `simplify_debts bool default true`, `members_can_invite bool default true`, `is_direct bool default false` (a hidden 2-person group used for 1:1 expenses between friends), `created_by`, timestamps, `archived_at`.
- `group_members`: `(group_id, user_id)` pk, `role group_role not null default 'member'`, `joined_at`. Exactly one `owner` per group (partial unique index).
- `group_invites`: `id`, `group_id`, `code text unique` (url-safe, 10+ chars), `email text?`, `role group_role default 'member'` (cannot be owner), `max_uses int?`, `uses int default 0`, `expires_at timestamptz?`, `created_by`, `revoked_at`.

### Money

- `expenses`: `id`, `group_id not null`, `event_id?`, `description text not null`, `amount_cents bigint > 0`, `currency char(3)`, `fx_rate numeric(18,8) default 1` (rate into the group currency, snapshotted at creation), `paid_by uuid`, `split_type`, `category text`, `notes text`, `spent_at date default current_date`, `receipt_path text`, `recurring_id?`, `created_by`, timestamps, `deleted_at` (soft delete, restorable).
- `expense_splits`: `(expense_id, user_id)` pk, `share_cents bigint not null`, `weight numeric` (percent or share count, for display). Constraint (deferred, via trigger): splits sum to `amount_cents`.
- `recurring_expenses`: template rows (`group_id`, `description`, `amount_cents`, `currency`, `paid_by`, `split_type`, `splits jsonb`, `recurrence`, `next_run_on date`, `active bool`). A `pg_cron` job materializes due rows into `expenses` daily.
- `settlements`: `id`, `group_id`, `from_user`, `to_user`, `amount_cents > 0`, `currency`, `fx_rate`, `note`, `settled_at`, `created_by`, `deleted_at`.
- `fx_rates`: `(base, quote, day)` pk, `rate numeric`. Filled by the `fx-sync` edge function (Frankfurter API, free, no key).
- View `group_balances` (`security_invoker`): `group_id`, `user_id`, `net_cents` (positive = is owed), in group currency.

### Plans

- `events`: `id`, `group_id`, `title`, `description`, `location`, `emoji`, `status event_status default 'polling'`, `window_start date`, `window_end date`, `day_start_minute int default 480`, `day_end_minute int default 1320`, `slot_minutes int default 30`, `duration_minutes int default 120`, `min_attendees int default 2`, `starts_at timestamptz?`, `ends_at timestamptz?`, `rsvp_deadline timestamptz?`, `created_by`, timestamps.
- `availability`: `(event_id, user_id, slot_start)` pk, `level availability_level`.
- `availability_requests`: `(event_id, user_id)` pk, `requested_by`, `requested_at`, `responded_at`.
- `event_rsvps`: `(event_id, user_id)` pk, `status rsvp_status`, `updated_at`.
- `calendar_connections`: `user_id`, `provider ('google'|'microsoft')`, encrypted tokens in Vault, `last_synced_at`. Feature-flagged off until OAuth credentials exist.
- `busy_blocks`: `(user_id, starts_at, ends_at, source)`; imported busy time, shown as hatched cells on the availability grid.

### Feed, notifications, platform

- `activity`: `id`, `group_id`, `actor_id`, `verb text` (`expense.created`, `settlement.created`, `member.joined`, `event.scheduled`, ...), `subject_id uuid`, `data jsonb`, `created_at`. Written by triggers.
- `comments`: `id`, `expense_id?`, `event_id?`, `author_id`, `body`, `created_at`, `deleted_at`.
- `notifications`: `id`, `user_id`, `type text`, `data jsonb`, `read_at`, `created_at`.
- `push_tokens`: `(user_id, token)` pk, `platform push_platform`, `subscription jsonb` (web push), `last_seen_at`.
- `app_config`: `key text pk`, `value jsonb` (feature flags, `min_client_version` per platform). Readable by everyone.

## Roles

| Permission                                          | Owner | Admin                          | Member                  |
| --------------------------------------------------- | ----- | ------------------------------ | ----------------------- |
| Add/edit own expenses, availability, RSVP, comments | yes   | yes                            | yes                     |
| Create events, request availability                 | yes   | yes                            | yes                     |
| Lock / cancel an event                              | yes   | yes                            | creator only            |
| Edit/delete others' expenses                        | yes   | yes                            | no                      |
| Create invites                                      | yes   | yes                            | if `members_can_invite` |
| Create admin invites                                | yes   | yes                            | no                      |
| Remove members, change roles                        | yes   | admins can manage members only | no                      |
| Edit group settings                                 | yes   | yes                            | no                      |
| Delete group, transfer ownership                    | yes   | no                             | no                      |

A member cannot leave or be removed while their `net_cents` in that group is non-zero.

## RPCs

| Function                                                                                                          | Notes                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_group(name, emoji, color, currency)`                                                                      | creator becomes owner                                                                                                                                         |
| `create_invite(group_id, role, max_uses, expires_at, email)` → invite                                             |                                                                                                                                                               |
| `invite_preview(code)` → group name, emoji, member count, first names                                             | callable by `anon`, for the join page                                                                                                                         |
| `accept_invite(code)` → group_id                                                                                  | validates expiry/uses/revoked, adds member, creates friendships                                                                                               |
| `set_member_role(group_id, user_id, role)` / `remove_member` / `leave_group` / `transfer_ownership`               | role checks per table above                                                                                                                                   |
| `get_or_create_direct_group(friend_id)` → group_id                                                                | 1:1 expenses                                                                                                                                                  |
| `create_expense(payload jsonb)` / `update_expense(id, payload jsonb)`                                             | validates splits sum, membership, fx snapshot                                                                                                                 |
| `delete_expense(id)` / `restore_expense(id)`                                                                      | soft delete                                                                                                                                                   |
| `settle_up(group_id, to_user, amount_cents, currency, note)`                                                      |                                                                                                                                                               |
| `simplified_debts(group_id)` → rows `(from_user, to_user, amount_cents)`                                          | greedy max-creditor/max-debtor, tie-break by user id                                                                                                          |
| `set_availability(event_id, slots jsonb)`                                                                         | replaces caller's rows for that event, marks request responded                                                                                                |
| `request_availability(event_id, user_ids uuid[])`                                                                 | creates notifications                                                                                                                                         |
| `best_slots(event_id, limit int default 5)` → `starts_at, ends_at, yes_count, maybe_count, score, missing uuid[]` | score = yes + 0.5 * maybe, a person counts only if available for every slot in the duration, filtered by `min_attendees`, ordered by score desc then earliest |
| `schedule_event(event_id, starts_at)` / `cancel_event(event_id)`                                                  |                                                                                                                                                               |
| `my_timeline(from, to)`                                                                                           | upcoming events across all my groups with my RSVP and request state                                                                                           |
| `delete_my_account()`                                                                                             | anonymizes profile (tombstone name), removes PII, deletes auth user via edge function                                                                         |

## Edge functions

- `notify`: fans a notification out to web push (VAPID) and, later, Expo push.
- `ics-feed`: per-user `.ics` subscription URL (token in query string).
- `og-invite`: Open Graph HTML for invite links.
- `fx-sync`: daily FX rates from Frankfurter.
- `delete-account`: service-role deletion of the auth user.

## Hosting

- Web: Cloudflare Pages, project `potluck`, `potluck.pages.dev` (no custom domain yet).
- Backend: Supabase project `mzotlkpghnrwbezcazld`.
- Email: Supabase built-in SMTP for now (rate-limited). Swap to Resend when a domain exists.
