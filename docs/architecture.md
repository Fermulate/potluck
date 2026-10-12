# Architecture

Potluck is a static web app (installable PWA) backed entirely by Supabase. There is no application server: the client talks to Supabase directly and Postgres Row Level Security is the authorization layer.

## System context

Who talks to Potluck and what Potluck talks to.

```mermaid
flowchart LR
  member(["Group member<br/>splits costs, plans events"])
  guest(["Invitee<br/>opens an invite link"])
  calendar(["Calendar app<br/>subscribes to an .ics feed"])

  subgraph potluck["Potluck"]
    web["Web app (PWA)"]
    backend["Supabase project"]
  end

  frankfurter[("Frankfurter API<br/>ECB reference rates")]
  pushsvc[("Browser push services<br/>FCM, Mozilla, Apple")]
  smtp[("Supabase SMTP<br/>auth emails")]

  member --> web
  guest --> web
  calendar -->|"GET ics-feed?token="| backend
  web --> backend
  backend -->|daily| frankfurter
  backend -->|web push, VAPID| pushsvc
  backend --> smtp
  pushsvc --> member
```

## Containers

There is no application server. The browser loads static files from Cloudflare and then talks to Supabase directly with the publishable key and the user's JWT.

```mermaid
flowchart TB
  user(["Browser"])

  subgraph cf["Cloudflare Workers (static assets)"]
    assets["apps/web dist<br/>index.html, JS, service worker<br/>SPA fallback for unknown paths"]
  end

  subgraph sb["Supabase"]
    auth["Auth (GoTrue)<br/>email + password, magic link"]
    rest["PostgREST<br/>tables + RPCs in public"]
    rt["Realtime<br/>postgres_changes"]
    storage["Storage<br/>avatars, group-covers, receipts"]
    edge["Edge Functions (Deno)<br/>notify, fx-sync, ics-feed, delete-account"]
    subgraph pg["Postgres 17"]
      public["public schema<br/>tables, RLS, definer RPCs"]
      private["private schema<br/>policy helpers, triggers, jobs"]
      cron["pg_cron"]
      net["pg_net"]
      vault["Vault<br/>project_url, edge_secret"]
    end
  end

  user -->|HTTPS| assets
  user -->|supabase-js| auth
  user -->|supabase-js| rest
  user -->|websocket| rt
  user -->|upload, signed URL| storage
  user -->|"POST delete-account (JWT)"| edge
  rest --> public
  public --> private
  rt --> public
  cron --> private
  private --> net
  net -->|"x-potluck-secret"| edge
  vault -.-> net
  edge -->|service role| rest
```

## Packages

A native app (Expo) is planned. Everything below the screens is shared:

| Package           | Purpose                                                                     | Platform     |
| ----------------- | --------------------------------------------------------------------------- | ------------ |
| `packages/core`   | split math, rounding, debt simplification, slot ranking and heat levels, recurrence dates, role checks, validation schemas | any (no DOM) |
| `packages/api`    | typed Supabase client, generated DB types, TanStack Query options           | any (no DOM) |
| `packages/tokens` | design tokens as TS                                                         | any          |
| `packages/i18n`   | strings, money/date formatting via `Intl`                                   | any          |
| `packages/ui`     | web React components                                                        | web          |
| `apps/web`        | web screens and routing                                                     | web          |

### Package dependencies

Arrows point from a package to what it imports. Shared packages never import `@potluck/ui`, `@potluck/web` or `react-dom`; ESLint (`no-restricted-imports`, `no-restricted-globals` for `window`, `document`, `localStorage`) and a DOM-free `lib` in their tsconfig enforce it.

```mermaid
flowchart BT
  core["@potluck/core<br/>zod, date-fns-tz"]
  i18n["@potluck/i18n<br/>Intl only"]
  tokens["@potluck/tokens"]
  api["@potluck/api<br/>supabase-js, TanStack Query"]
  ui["@potluck/ui<br/>React DOM"]
  web["@potluck/web<br/>Vite, TanStack Router"]
  native["apps/native (planned, Expo)"]

  i18n --> core
  ui --> tokens
  web --> core
  web --> i18n
  web --> tokens
  web --> api
  web --> ui
  native -.-> core
  native -.-> i18n
  native -.-> tokens
  native -.-> api

  classDef shared fill:#eef6ee,stroke:#4a7a4a
  classDef webonly fill:#f6eee6,stroke:#8a5a2a
  class core,i18n,tokens,api shared
  class ui,web webonly
```

`packages/api` does not depend on `core`: it only knows the database types. Packages export TypeScript source (`"exports": { ".": "./src/index.ts" }`), so there is no build step between them; Vite and Vitest compile them on the fly.

## Ground rules

- Money is stored as integer minor units (`bigint` cents). Never floats.
- Every multi-row write (expense + splits, settle up, accept invite, lock event) goes through a `security definer` RPC that re-checks membership, so it is atomic and the same for every client.
- Timestamps are `timestamptz` (UTC). Clients render in the viewer's timezone (`profiles.timezone`).
- Migrations are additive. Native clients lag behind, so an RPC that needs a breaking change gets a `_v2` name instead.
- RLS is on for every table in `public`. Every policy has pgTAP coverage in `supabase/tests/`.
- Views use `security_invoker = true`.
- Helper functions used inside policies are `security definer`, `stable`, `set search_path = ''`, and live in a `private` schema so they are not exposed over the API.

## Schema (public)

The ER diagrams below are drawn from the migrations and split in three so they stay readable. Columns are trimmed to keys and the ones that matter for behavior; the lists after the diagrams have the rest. `profiles` and `groups` appear in more than one diagram.

### Diagram: identity, social and groups

```mermaid
erDiagram
  AUTH_USERS ||--|| profiles : "trigger creates"
  profiles ||--o{ friendships : "has (both directions)"
  profiles ||--o{ blocks : blocks
  profiles ||--o{ reports : files
  groups |o--o{ reports : "about"
  profiles ||--o{ group_members : joins
  groups ||--|{ group_members : has
  groups ||--o{ group_invites : has
  profiles |o--o{ group_invites : creates

  AUTH_USERS {
    uuid id PK
    text email
  }
  profiles {
    uuid id PK, FK "auth.users, cascade"
    text display_name "1..80 chars"
    text avatar_path
    text timezone "IANA, default UTC"
    char3 default_currency
    text locale
    timestamptz deleted_at "tombstone"
  }
  friendships {
    uuid user_id PK, FK
    uuid friend_id PK, FK
  }
  blocks {
    uuid blocker_id PK, FK
    uuid blocked_id PK, FK
  }
  reports {
    uuid id PK
    uuid reporter_id FK
    uuid subject_user_id FK
    uuid group_id FK
    text reason
  }
  groups {
    uuid id PK
    text name
    char3 currency "locked once money exists"
    bool simplify_debts
    bool members_can_invite
    bool is_direct "hidden 1:1 group"
    uuid created_by FK
    timestamptz archived_at
  }
  group_members {
    uuid group_id PK, FK
    uuid user_id PK, FK
    group_role role "exactly one owner"
    timestamptz joined_at
  }
  group_invites {
    uuid id PK
    uuid group_id FK
    text code UK "url-safe, 10..64"
    text email "optional binding"
    group_role role "never owner"
    int max_uses
    int uses
    timestamptz expires_at
    timestamptz revoked_at
  }
```

### Diagram: money

```mermaid
erDiagram
  groups ||--o{ expenses : has
  groups ||--o{ settlements : has
  groups ||--o{ recurring_expenses : has
  expenses ||--|{ expense_splits : "split into"
  profiles ||--o{ expense_splits : owes
  profiles ||--o{ expenses : "paid_by"
  profiles ||--o{ settlements : "from_user, to_user"
  recurring_expenses |o--o{ expenses : materializes
  events |o--o{ expenses : "event_id"
  fx_rates }o..o{ expenses : "rate snapshot"

  groups {
    uuid id PK
    char3 currency
  }
  profiles {
    uuid id PK
  }
  events {
    uuid id PK
  }
  expenses {
    uuid id PK
    uuid group_id FK
    uuid event_id FK
    text description
    bigint amount_cents "minor units, > 0"
    char3 currency
    numeric fx_rate "18,8, into group currency"
    uuid paid_by FK "restrict"
    split_type split_type
    date spent_at
    text receipt_path "group_id/..."
    uuid recurring_id FK
    uuid created_by FK
    timestamptz deleted_at "soft delete"
  }
  expense_splits {
    uuid expense_id PK, FK
    uuid user_id PK, FK "restrict"
    bigint share_cents "sum = amount_cents"
    numeric weight "percent or shares, display"
  }
  recurring_expenses {
    uuid id PK
    uuid group_id FK
    bigint amount_cents
    char3 currency
    uuid paid_by FK
    split_type split_type
    jsonb splits "create_expense format"
    recurrence recurrence
    date next_run_on
    bool active
  }
  settlements {
    uuid id PK
    uuid group_id FK
    uuid from_user FK "payer, restrict"
    uuid to_user FK "restrict"
    bigint amount_cents
    char3 currency
    numeric fx_rate
    timestamptz settled_at
    timestamptz deleted_at
  }
  fx_rates {
    char3 base PK
    char3 quote PK
    date day PK
    numeric rate "1 base = rate quote"
  }
```

The `group_balances` view (`security_invoker`) sums `expenses`, `expense_splits` and `settlements` into `(group_id, user_id, net_cents)`.

### Diagram: plans, feed and platform

```mermaid
erDiagram
  groups ||--o{ events : has
  events ||--o{ availability : collects
  events ||--o{ availability_requests : sends
  events ||--o{ event_rsvps : collects
  events |o--o{ comments : "event_id"
  expenses |o--o{ comments : "expense_id"
  groups ||--o{ comments : "group_id (derived)"
  groups ||--o{ activity : feed
  profiles ||--o{ availability : paints
  profiles ||--o{ event_rsvps : answers
  profiles ||--o{ busy_blocks : imports
  profiles ||--o{ calendar_connections : links
  profiles ||--o| calendar_feed_tokens : owns
  profiles ||--o{ notifications : receives
  profiles ||--o{ push_tokens : registers

  groups {
    uuid id PK
  }
  profiles {
    uuid id PK
  }
  expenses {
    uuid id PK
  }
  events {
    uuid id PK
    uuid group_id FK
    text title
    event_status status "polling, scheduled, cancelled, done"
    text timezone "IANA zone of the grid"
    date window_start "max 62 days"
    date window_end
    int day_start_minute
    int day_end_minute
    int slot_minutes "15, 30 or 60"
    int duration_minutes
    int min_attendees
    timestamptz starts_at
    timestamptz ends_at
    timestamptz reminder_sent_at
  }
  availability {
    uuid event_id PK, FK
    uuid user_id PK, FK
    timestamptz slot_start PK "UTC cell start"
    availability_level level "yes or maybe"
  }
  availability_requests {
    uuid event_id PK, FK
    uuid user_id PK, FK
    uuid requested_by FK
    timestamptz responded_at
  }
  event_rsvps {
    uuid event_id PK, FK
    uuid user_id PK, FK
    rsvp_status status
  }
  busy_blocks {
    bigint id PK
    uuid user_id FK
    timestamptz starts_at
    timestamptz ends_at
    text source
  }
  calendar_connections {
    uuid id PK
    uuid user_id FK
    text provider "google or microsoft"
    uuid access_token_secret_id "Vault id"
    uuid refresh_token_secret_id "Vault id"
  }
  calendar_feed_tokens {
    uuid user_id PK, FK
    text token UK "32+ chars"
  }
  comments {
    uuid id PK
    uuid group_id FK
    uuid expense_id FK
    uuid event_id FK
    uuid author_id FK
    text body
    timestamptz deleted_at
  }
  activity {
    uuid id PK
    uuid group_id FK
    uuid actor_id FK
    text verb
    uuid subject_id
    jsonb data
  }
  notifications {
    uuid id PK
    uuid user_id FK
    text type
    jsonb data
    timestamptz read_at
  }
  push_tokens {
    uuid user_id PK, FK
    text token PK
    push_platform platform
    jsonb subscription "web push"
  }
  app_config {
    text key PK
    jsonb value
  }
```

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
- `calendar_feed_tokens`: `user_id pk`, `token text unique` (32+ chars), `created_at`. The only credential for the `ics-feed` URL. Owners can read their row; nobody writes it directly.

## Roles

| Permission                                          | Owner | Admin                          | Member                  |
| --------------------------------------------------- | ----- | ------------------------------ | ----------------------- |
| Add/edit own expenses, availability, RSVP, comments | yes   | yes                            | yes                     |
| Create events, request availability                 | yes   | yes                            | yes                     |
| Lock / cancel an event                              | yes   | yes                            | creator only            |
| Edit/delete others' expenses                        | yes   | yes                            | no                      |
| Create invites                                      | yes   | yes                            | if `members_can_invite` |
| Create admin invites                                | yes   | no                             | no                      |
| Remove members, change roles                        | yes   | admins can manage members only | no                      |
| Edit group settings                                 | yes   | yes                            | no                      |
| Delete group, transfer ownership                    | yes   | no                             | no                      |

A member cannot leave or be removed while their `net_cents` in that group is non-zero. "Own" expenses are the ones you created or paid.

`create_invite` is the source of truth for admin invites: only the owner can mint them. `can()` in `packages/core/src/roles` currently lets admins through for `invite.create` with `inviteRole: 'admin'`, so the UI can offer a button the server will reject.

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
| `calendar_feed_token(rotate bool default false)` → text                                                           | returns (and creates on first call) the caller's `.ics` feed token; `rotate` issues a new one and breaks old subscriptions                                    |

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
- `delete_my_account()` returns void. It tombstones the profile (`Former member`, avatar cleared, timezone and locale reset, `deleted_at` set), hands owned groups to the longest-standing admin (else member) or deletes groups with nobody else, removes zero-balance memberships (open balances stay), deletes push tokens, calendar links, busy blocks, notifications, availability, RSVPs, friendships and blocks, and revokes open invites. Closed accounts get `account_deleted` from every RPC. Money tables reference `profiles` with `on delete restrict`, so the `delete-account` edge function must soft delete the auth user (`auth.admin.deleteUser(id, true)`); a hard delete would cascade into the profile and is refused. Two gaps remain: nothing removes the avatar files in the `avatars` bucket yet (the edge function does not), and the `calendar_feed_tokens` row survives, so an old feed URL keeps serving events from groups where the closed account still has an open balance.

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
- pg_cron: `materialize-recurring-expenses` daily at 00:10 UTC (catches up at most 12 periods per template per run; deactivates templates whose people left; retries when an FX rate is missing), `event-reminders` hourly at :05 (reminders once per event starting within 24h, then marks ended events `done`) and `fx-sync` daily at 16:30 UTC (calls the `fx-sync` edge function through `private.invoke_edge_function`).
- Database to edge function hooks (`20261105160000_edge_function_hooks.sql`): `private.invoke_edge_function(fn, body)` posts through `pg_net` with the `x-potluck-secret` header. It reads `project_url` and `edge_secret` from Vault and does nothing when either is missing, so the local stack and CI never call out. The `notifications_push` trigger calls `notify` for every new notification.

### Local demo data

`supabase/seed.sql` creates `ava`, `ben`, `cleo`, `dev`, `eli` and `fay` at `@potluck.test` (password `potluck-demo`), the groups Hike crew, Roommates and Dim sum club, a 1:1 between Ava and Fay, about 30 expenses (all split types, one in EUR), settlements, a polling hike with availability from five people and an open request, a scheduled taco night with RSVPs, comments, and an invite code `hikecrew-demo`.

## Security model

The browser is untrusted. It holds the publishable key and, once signed in, a short-lived JWT (`jwt_expiry = 3600`, refresh tokens rotate). Everything it can do is decided inside Postgres.

### Layers

1. **Grants.** Every table starts with `revoke all ... from anon, authenticated`, then each migration grants back only the columns a client may touch. For example `profiles` grants `update (display_name, avatar_path, timezone, default_currency, locale)`, so a client cannot set `deleted_at` even on its own row. In the database, `anon` gets `select` on `app_config` and `execute` on `invite_preview`, and nothing else. The public `avatars` and `group-covers` buckets are readable without signing in.
2. **Row Level Security.** Enabled on every table in `public`. Policies answer "which rows" using helpers from the `private` schema. Policies use `(select auth.uid())` and `in (select private.my_group_ids())` so Postgres evaluates them once per statement instead of once per row.
3. **Security definer RPCs.** Multi-row writes (expense plus splits, settle up, joining, role changes, scheduling) have no insert or update policy at all. They go through `public.*` functions that run as the owner, start with `private.require_user()` (signed in, account not closed) and `private.require_member(group_id)`, then check the role rules themselves. All of them set `search_path = ''` and schema-qualify every name.
4. **Triggers and constraints** hold invariants no client can skip: exactly one owner per group, splits sum to the amount, group currency locked once money exists, `comments.group_id` copied from the parent, only the author edits a comment body.

### The private schema

`private` is not in `[api].schemas`, so PostgREST never exposes it. `revoke all on schema private from public` plus `alter default privileges ... revoke execute on functions from public` means a new function is callable by nobody until a migration grants it. API roles get `usage` on the schema and `execute` only on the policy helpers (`is_group_member`, `group_role`, `is_group_admin`, `my_group_ids`, `my_event_ids`, `shares_group_with`, `my_contact_ids`, `can_manage_event`) and a few pure functions (`try_uuid`, `minor_units`, `convert_minor`, `is_time_zone`). The helpers are `security definer` so they can read `group_members` without recursing into its own policy, and they only ever answer questions about `auth.uid()`.

Trigger functions, cron jobs, `require_user`, `require_member`, `member_balance`, `compute_splits`, `invoke_edge_function` and `notify` are not executable by `anon` or `authenticated`.

### Storage

Paths start with an owning id, and policies parse it with `storage.foldername(name)[1]`. `private.try_uuid` turns a malformed folder into `null` instead of an error, so a bad path is denied.

| Bucket         | Public read | Path prefix  | Write                                                                                   | Limits                     |
| -------------- | ----------- | ------------ | --------------------------------------------------------------------------------------- | -------------------------- |
| `avatars`      | yes         | `<user_id>`  | the user                                                                                | 5 MB, png/jpeg/webp/gif    |
| `group-covers` | yes         | `<group_id>` | owner and admins                                                                        | 10 MB, png/jpeg/webp       |
| `receipts`     | no          | `<group_id>` | members upload; the uploader (`owner_id`) or an admin replaces or deletes; members read | 10 MB, images, heic or pdf |

`create_expense` also refuses a `receipt_path` that does not start with `<group_id>/`, so an expense cannot point at another group's receipt.

### Edge function auth

Each function uses one of three schemes. `verify_jwt` is set per function in `supabase/config.toml`.

| Function         | `verify_jwt` | Credential                                       | Checked by                                                                                                          |
| ---------------- | ------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `delete-account` | true         | the user's JWT                                   | the gateway, then `auth.getUser()`; the RPC runs as the caller so its own checks apply                              |
| `notify`         | false        | `x-potluck-secret` header equal to `EDGE_SECRET` | `hasEdgeSecret()`, constant-time compare; only `private.invoke_edge_function` knows the secret (from Vault)         |
| `fx-sync`        | false        | same shared secret                               | same                                                                                                                |
| `ics-feed`       | false        | `?token=` from `calendar_feed_tokens`            | lookup with the service role; unknown or short tokens get a plain 404. Calendar apps cannot send headers, hence the query string |

The service-role client (`_shared/admin.ts`) bypasses RLS, so each function authorizes the caller before touching it.

## Realtime

The `supabase_realtime` publication carries `availability`, `expenses`, `expense_splits`, `settlements`, `activity`, `notifications`, `event_rsvps`, `events` and `group_members`. Realtime applies the subscriber's RLS `select` policies before it delivers a change, so a client only hears about rows it could read anyway.

Clients do not patch their cache from the payload. A change invalidates the matching TanStack Query keys and the query refetches through the normal RLS path. One channel per screen:

| Channel           | Tables (filter)                                                                                           | Refetches                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `money:<groupId>` | `expenses`, `settlements`, `activity` inserts (`group_id=eq.<groupId>`)                                    | group money queries, the changed expense, comments |
| `plan:<eventId>`  | `availability`, `event_rsvps` (`event_id=eq`), `events` (`id=eq`), `activity` inserts (`group_id=eq`)       | heatmap, `best_slots`, requests, RSVPs, comments  |

The plan channel batches invalidations for 300 ms so a friend dragging across twenty cells causes one refetch, not twenty.

## Scheduled jobs

All jobs are `pg_cron` entries created by migrations, so every environment gets the same schedule. `cron.schedule` with an existing name updates the job, which keeps the migrations rerunnable. Times are UTC.

| Job                              | Schedule      | Runs                                                                  | Does                                                                                                                                                                                      |
| -------------------------------- | ------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `materialize-recurring-expenses` | `10 0 * * *`  | `private.materialize_recurring_expenses()`                            | Writes due recurring templates as real expenses, catching up at most 12 periods per template. Deactivates templates whose payer or people left. Leaves a template due when no FX rate exists yet |
| `event-reminders`                | `5 * * * *`   | `private.send_event_reminders()` then `private.finish_past_events()`  | `event.reminder` to going and maybe, `rsvp.reminder` to members who have not answered, once per event starting in the next 24 hours. Then flips ended scheduled events to `done`          |
| `fx-sync`                        | `30 16 * * *` | `private.invoke_edge_function('fx-sync')`                             | Asks the edge function to pull the day's ECB rates. The ECB publishes around 16:00 CET                                                                                                    |

Each recurring template runs inside its own `begin ... exception` block, so one bad template logs a warning and the rest still run.

## Money conventions

- **Integer minor units.** Every amount is a `bigint` in the currency's minor unit: cents for USD, yen for JPY, fils for KWD. `private.minor_units()` and `minorUnits()` in `packages/core/src/currency` share the same ISO 4217 table (0, 2 or 3 digits). No floats anywhere, in SQL or TypeScript. Core uses `BigInt` for intermediate products.
- **Rounding is half away from zero.** Postgres `round(numeric)` does this; `convert()` in core reproduces it, so a client preview equals the stored value.
- **Largest remainder, uuid tie-break.** Splitting an amount by weights gives everyone `floor(amount * w / sum)`. The leftover units go one each to the largest fractional remainders. Ties go to the smaller user id compared as plain code points, which matches Postgres `uuid` ordering. `allocate()` in core, `private.compute_splits()` and the `group_balances` view all use this rule, so the same input gives the same cents on every client and on the server.
- **Fixed-point weights.** Percent and shares weights are scaled to 6 decimals before splitting. Percent weights must sum to exactly 100.
- **FX snapshot.** `fx_rate` is written once, when the expense or settlement is saved: the latest `fx_rates` row on or before `spent_at` (settlements use today), with the inverse pair as a fallback. Clients cannot send a rate. Editing an expense keeps its rate unless the currency changes. A missing rate raises `fx_rate_unavailable`.
- **Convert once per expense.** Balances convert the expense total into group currency once, credit the payer, then split that converted total over the splits by largest remainder. Each expense nets to exactly zero in group currency.

## Time zones

- Instants are `timestamptz` and travel as UTC ISO strings. Calendar dates (`spent_at`, `window_start`, `window_end`, `next_run_on`) are `date` with no zone; `packages/i18n` renders them pinned to UTC so June 12 stays June 12 for everyone.
- `profiles.timezone` (IANA) is the viewer's zone. `formatDate` and friends in `packages/i18n` require a `timeZone` argument and never fall back to the host zone.
- `events.timezone` is the zone the availability grid is drawn in. A cell is a wall-clock time in that zone, stored as its UTC instant in `availability.slot_start`. `buildSlots()` in core skips wall times that do not exist (spring forward) and uses the first of a repeated hour (fall back), so "8 pm" stays 8 pm across a DST change. `set_availability` checks every slot against the same grid with `at time zone`.
- Cron runs in UTC. `materialize-recurring-expenses` uses `current_date` in UTC.

## Edge functions

- `notify`: fans a notification out to web push (VAPID). Expo push tokens are skipped until the native app ships.
- `ics-feed`: per-user `.ics` subscription URL (token in query string).
- `fx-sync`: daily FX rates from Frankfurter.
- `delete-account`: runs `delete_my_account()` as the caller, then soft deletes the auth user with the service role.

There is no `og-invite` function yet. Invite links render the SPA, so link previews show the generic app title.

## Hosting

- Web: Cloudflare Workers static assets, worker `potluck` (`apps/web/wrangler.jsonc`), https://potluck.potluck-web.workers.dev (no custom domain yet). PR previews are worker versions with a `pr-<number>` alias.
- Backend: Supabase project `mzotlkpghnrwbezcazld`.
- Email: Supabase built-in SMTP for now (rate-limited). Swap to Resend when a domain exists.
