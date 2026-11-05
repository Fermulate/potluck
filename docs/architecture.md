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

## Database implementation notes

The schema lives in `supabase/migrations`, pgTAP tests in `supabase/tests` (`pnpm db:test`), demo data in `supabase/seed.sql`. This section records what the migrations do beyond (or differently from) the tables above.

### Errors

Every RPC raises `message = <stable snake_case code>`, `detail = <readable English>`, `errcode = <sqlstate>`. Clients translate the code (PostgREST returns it as `message`, the English text as `details`). SQLSTATEs: `42501` not signed in or not allowed, `P0002` not found, `22023` invalid input, `23514` business rule. Common codes: `not_authenticated`, `account_deleted`, `not_a_member`, `not_allowed`, `member_not_found`, `member_has_balance`, `owner_must_transfer`, `invite_not_found`, `invite_expired`, `invite_used_up`, `invite_revoked`, `invite_wrong_email`, `splits_required`, `splits_sum_mismatch`, `split_amount_required`, `percent_sum`, `invalid_weight`, `zero_shares`, `duplicate_user`, `split_member_not_in_group`, `payer_not_in_group`, `fx_rate_unavailable`, `invalid_amount`, `expense_not_found`, `expense_deleted`, `event_not_found`, `event_not_polling`, `event_not_schedulable`, `invalid_slot`, `duplicate_slot`, `group_currency_locked`.

### RPC details and deviations

- `create_group(name, emoji?, color?, currency?)` returns the `groups` row. Currency defaults to the caller's `default_currency`.
- `create_invite(group_id, role = 'member', max_uses?, expires_at?, email?)` returns the invite row. Members can invite only when `members_can_invite`; only the owner can create `admin` invites; direct and archived groups cannot have invites.
- `invite_preview(code)` returns `group_id, name, emoji, color, cover_path, member_count, first_names text[] (owner first, max 5), status ('valid' | 'expired' | 'revoked' | 'used_up'), is_member`. Unknown codes raise `invite_not_found`.
- `accept_invite(code)`: already being a member returns the group id without using up the invite. Email-bound invites compare against the auth email, case-insensitive.
- `set_member_role`: admins may change roles of plain members only (including promoting to admin); nobody can grant `owner` here.
- `leave_group`: the owner must transfer first unless they are the last member, in which case leaving deletes the group.
- `get_or_create_direct_group(friend_id)`: the friend must be a friend or share a group, and neither may have blocked the other. Creates a group named `Direct` (caller owner, friend admin, `members_can_invite = false`).
- `create_expense(payload)` / `update_expense(id, payload)` / `delete_expense(id)` / `restore_expense(id)` return the `expenses` row. Payload keys are documented at the top of the expenses RPC migration. Extra payload key `recurrence` (`weekly` | `monthly` | `yearly`, create only) also creates a `recurring_expenses` template whose first run is one period after `spent_at`. `receipt_path` must start with `<group_id>/`. Members edit expenses they created or paid; admins and the owner edit any. Restoring fails if someone in the expense has left.
- Splits: `exact` and `itemized` need `share_cents` for every person, used as given (must sum to the amount). `equal`, `percent` (weights sum to exactly 100) and `shares` are always derived on the server with 6-decimal fixed-point weights and largest remainder, ties by user id, same as `packages/core`; any `share_cents` sent for them is ignored.
- `settle_up(group_id, to_user, amount_cents, currency?, note?)` returns the settlement. The payer is always the caller and `settled_at` is now.
- Extra RPC `delete_settlement(id)`: soft delete by payer, recipient, recorder or admin.
- `simplified_debts(group_id)`: greedy largest creditor vs largest debtor, ties by user id. Always simplifies, whatever `groups.simplify_debts` says (the client decides what to show).
- `set_availability(event_id, slots)` returns the number of slots saved. `slots` is an array of `{slot_start, level}` objects; `level` defaults to yes. Every slot must be a grid cell: inside the date window and `[day_start_minute, day_end_minute)` in `events.timezone`, aligned to `slot_minutes`. Only while the event is `polling`.
- `request_availability(event_id, user_ids?)` returns how many people were asked. `null` or empty means every member (except the caller) who has not answered.
- `best_slots(event_id, limit = 5)`: candidates are the distinct `slot_start`s in current members' availability; durations round up to whole cells; yes needs yes on every covered cell, maybe needs yes or maybe on all of them; `missing` lists members who cannot make the whole duration, sorted by id; `min_attendees` counts yes + maybe; capped at 100 rows. Same rules as `rankSlots` in `packages/core`. Past candidates are not filtered out.
- `schedule_event(event_id, starts_at)` also reschedules an already scheduled event and sets `ends_at = starts_at + duration`. `cancel_event` is idempotent. Owner, admins or the event creator.
- `my_timeline(from = now(), to = now() + 60 days)` returns `event_id, group_id, group_name, group_emoji, group_color, title, emoji, location, status, timezone, starts_at, ends_at, window_start, window_end, rsvp_deadline, my_rsvp, going_count, availability_requested, availability_submitted` for scheduled events in range and open polls overlapping it.
- `delete_my_account()` returns void. It tombstones the profile (`Former member`, avatar cleared, timezone and locale reset, `deleted_at` set), hands owned groups to the longest-standing admin (else member) or deletes groups with nobody else, removes zero-balance memberships (open balances stay), deletes push tokens, calendar links, busy blocks, notifications, availability, RSVPs, friendships and blocks, and revokes open invites. Closed accounts get `account_deleted` from every RPC. Money tables reference `profiles` with `on delete restrict`, so the `delete-account` edge function must soft delete the auth user (`auth.admin.deleteUser(id, true)`); a hard delete would cascade into the profile and is refused. Avatar files are left for the edge function too.

### Schema additions

- `events.timezone` (IANA zone the window is expressed in, default `UTC`) and `events.reminder_sent_at` (set by the reminder job).
- `comments.group_id`, filled from the expense or event by a trigger and used by RLS.
- `calendar_connections`: `id`, `account_email`, `access_token_secret_id`, `refresh_token_secret_id` (Vault ids, not readable by clients), unique `(user_id, provider)`.
- `busy_blocks.id` (identity) with unique `(user_id, starts_at, ends_at, source)`.
- `recurring_expenses.category`, `created_by`, timestamps. `push_tokens.created_at`, `app_config.updated_at`.
- A group's currency cannot change once it has expenses or settlements.
- Exactly one owner per group is enforced by the partial unique index plus a deferred constraint trigger. Splits summing to the amount is a deferred constraint trigger.

### Money math

`group_balances` matches `computeBalances` in `packages/core`: each expense is converted once (`round(amount * fx_rate)`, half away from zero, adjusted for currencies whose minor unit is not 2 digits) and the payer is credited that total; the total is spread over the splits in proportion to `share_cents` by largest remainder (ties by user id), so every expense nets to exactly zero. Settlements are converted the same way. `fx_rate` is snapshotted on write from the latest `fx_rates` row on or before the expense date (inverse pair as fallback); clients cannot supply their own rate.

### Access

Clients write directly (RLS-checked) only to: `profiles` (own display fields), `groups` (admins: settings; owner: delete), `group_invites` (revoke or delete, admins or creator), `events` (members insert polls; creator or admins edit details and delete), `event_rsvps` (own), `comments` (insert own, author edits, author or admin soft deletes), `notifications` (own `read_at`, delete), `push_tokens`, `blocks`, `reports`, `busy_blocks` (own), `recurring_expenses` (creator or admin: `active`, `description`, `category`, `next_run_on`, delete), `friendships` (delete either side). Everything else goes through RPCs. Profiles are visible to yourself, people you share a group with and friends. Busy blocks are private. `app_config` is readable by `anon`.

### Activity and notifications

Activity verbs: `group.created`, `group.updated`, `member.joined`, `member.left`, `member.removed`, `member.role_changed`, `expense.created`, `expense.updated`, `expense.deleted`, `expense.restored`, `settlement.created`, `settlement.deleted`, `event.created`, `event.scheduled` (also on reschedule), `event.cancelled`, `availability.requested`, `comment.created`.

Notification types: `expense.created` (split members, with their `share_cents`), `expense.updated`, `settlement.created`, `member.joined` (owner and admins, not for direct groups), `event.created`, `event.scheduled`, `event.cancelled`, `availability.requested`, `comment.created`, `event.reminder` (going or maybe), `rsvp.reminder` (no answer yet). The actor and closed accounts are never notified. `data` carries `group_id`, the subject id and `actor_id`.

### Storage, realtime, cron

- Buckets: `avatars` (public, `<user_id>/...`, owner writes), `group-covers` (public, `<group_id>/...`, owner and admins write), `receipts` (private, `<group_id>/...`, members read and upload, uploader or admins replace and delete).
- `supabase_realtime` publishes `availability`, `expenses`, `expense_splits`, `settlements`, `activity`, `notifications`, `event_rsvps`, `events`, `group_members`.
- pg_cron: `materialize-recurring-expenses` daily at 00:10 UTC (catches up at most 12 periods per template per run; deactivates templates whose people left; retries when an FX rate is missing) and `event-reminders` hourly at :05 (reminders once per event starting within 24h, then marks ended events `done`).

### Local demo data

`supabase/seed.sql` creates `ava`, `ben`, `cleo`, `dev`, `eli` and `fay` at `@potluck.test` (password `potluck-demo`), the groups Hike crew, Roommates and Dim sum club, a 1:1 between Ava and Fay, about 30 expenses (all split types, one in EUR), settlements, a polling hike with availability from five people and an open request, a scheduled taco night with RSVPs, comments, and an invite code `hikecrew-demo`.

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
