# Sequences

How the main flows move through the system, drawn from the migrations, edge functions and workflows. Function and table names match the code, so you can grep for anything you see here.

Participants used throughout:

- **Web**: `apps/web` in the browser, using `supabase-js` from `@potluck/api`.
- **Auth**, **PostgREST**, **Realtime**, **Storage**: Supabase services.
- **DB**: Postgres. RPCs live in `public`, helpers and triggers in `private`.
- **Edge**: Supabase Edge Functions in `supabase/functions`.

## Contents

- [Sign up and profile creation](#sign-up-and-profile-creation)
- [Create a group and invite people](#create-a-group-and-invite-people)
- [Join through an invite link](#join-through-an-invite-link)
- [Add an expense](#add-an-expense)
- [Settle up](#settle-up)
- [Simplified debts](#simplified-debts)

## Sign up and profile creation

Nobody writes to `profiles` on sign up. The `on_auth_user_created` trigger does it in the same transaction as the auth user, so a profile always exists for a signed-in user.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant W as Web
  participant A as Auth
  participant DB as DB

  U->>W: email, password, display name
  W->>A: auth.signUp(email, password, data: display_name, timezone)
  A->>DB: insert into auth.users
  DB->>DB: trigger on_auth_user_created<br/>private.handle_new_user()
  Note over DB: display_name from metadata,<br/>else full_name, name, email local part.<br/>timezone and locale from metadata, default UTC and en
  DB->>DB: insert into public.profiles
  alt production (enable_confirmations = true)
    A-->>U: confirmation email
    U->>A: open link
    A-->>W: redirect to the auth callback route with a session
  else local stack (confirmations off)
    A-->>W: session right away
  end
  W->>DB: select own profile (RLS: id = auth.uid())
```

## Create a group and invite people

`create_group` and `create_invite` are security definer RPCs because groups have no insert policy. The deferred `group_members_owner_check` trigger checks at commit that the new group has exactly one owner.

```mermaid
sequenceDiagram
  autonumber
  actor O as Owner
  participant W as Web
  participant DB as DB

  O->>W: name, emoji, color, currency
  W->>DB: rpc create_group(name, emoji, color, currency)
  DB->>DB: require_user()
  DB->>DB: insert groups, insert group_members (role owner)
  DB->>DB: activity group.created
  DB->>DB: commit: check_group_has_owner()
  DB-->>W: groups row

  O->>W: invite people
  W->>DB: rpc create_invite(group_id, role, max_uses, expires_at, email)
  DB->>DB: require_member(group_id)
  Note over DB: rejects direct and archived groups,<br/>members unless members_can_invite,<br/>admin invites unless caller is owner
  DB->>DB: insert group_invites (code = private.random_code(9))
  DB-->>W: invite row with code
  W-->>O: share link /join/:code
```

## Join through an invite link

The join page works before sign in. `invite_preview` is the one RPC `anon` may execute, and it only returns what the join page needs: group name, look, member count and up to five first names.

```mermaid
sequenceDiagram
  autonumber
  actor G as Invitee
  participant W as Web
  participant A as Auth
  participant DB as DB
  participant E as Edge notify

  G->>W: open /join/:code
  W->>DB: rpc invite_preview(code) as anon
  DB-->>W: name, emoji, member_count, first_names,<br/>status (valid, expired, revoked, used_up), is_member
  alt not signed in
    W->>A: sign up or sign in, redirect back to /join/:code
  end
  G->>W: Join
  W->>DB: rpc accept_invite(code)
  DB->>DB: require_user(), lock invite row (for update)
  alt already a member
    DB-->>W: group_id (invite not used up)
  else checks fail
    DB-->>W: invite_revoked, invite_expired,<br/>invite_used_up, invite_wrong_email or group_archived
  else ok
    DB->>DB: insert group_members (role from invite)
    DB->>DB: trigger befriend_group_members():<br/>friendships both ways, skipping blocked pairs
    DB->>DB: trigger: activity member.joined
    DB->>DB: trigger: notifications member.joined<br/>to owner and admins
    DB->>E: notifications_push via pg_net
    DB->>DB: update group_invites set uses = uses + 1
    DB-->>W: group_id
  end
  W->>W: navigate to /groups/:groupId
```

## Add an expense

The client previews the split with `@potluck/core` so people see exact cents while typing. The server does not trust that preview. For `equal`, `percent` and `shares` it recomputes the splits from the people and weights. Only `exact` and `itemized` use the client's `share_cents`, and those must add up to the amount.

```mermaid
sequenceDiagram
  autonumber
  actor P as Payer
  participant W as Web
  participant C as core
  participant S as Storage
  participant DB as DB
  participant E as Edge notify
  participant PS as Push service
  actor F as Friend

  P->>W: amount, currency, split type, people
  W->>C: splitEqual, splitPercent, splitShares or splitItemized
  C-->>W: shares in minor units (largest remainder)
  W->>C: expenseCreateSchema.parse(payload)
  opt receipt photo
    W->>S: upload receipts/:groupId/:file (policy: member of group)
  end
  W->>DB: rpc create_expense(payload)
  DB->>DB: require_member, payer and split people in group,<br/>receipt_path starts with group_id
  DB->>DB: fx_rate = 1, or private.fx_rate(currency, group currency, spent_at)
  alt no rate yet
    DB-->>W: error fx_rate_unavailable
  end
  DB->>DB: private.compute_splits(amount, split_type, splits)
  opt payload.recurrence
    DB->>DB: insert recurring_expenses (next_run_on = spent_at + 1 period)
  end
  DB->>DB: insert expenses, insert expense_splits
  DB->>DB: trigger: activity expense.created
  Note over DB: at commit (deferred constraint triggers)
  DB->>DB: check_expense_splits(): sum = amount_cents
  DB->>DB: expenses_notify(): notifications expense.created<br/>to split people and payer, never the actor
  DB->>E: notifications_push trigger, pg_net POST /functions/v1/notify<br/>x-potluck-secret from Vault
  DB-->>W: expenses row
  DB-->>W: Realtime: expenses, expense_splits, activity changes
  W->>W: invalidate money queries, refetch group_balances
  E->>E: hasEdgeSecret(), read web push_tokens with service role
  E->>PS: web-push sendNotification (VAPID, TTL 24h)
  alt subscription gone (404 or 410)
    E->>DB: delete that push_tokens row
  end
  PS-->>F: push message: title, body, url
```

Delivery to the screen depends on the service worker handling the `push` event. The PWA is built with `vite-plugin-pwa` in `generateSW` mode and has no `push` handler yet, so the last hop is not wired up.

## Settle up

The payer is always the caller, and `settled_at` is now. When the payment is in another currency the server snapshots today's FX rate.

```mermaid
sequenceDiagram
  autonumber
  actor P as Payer
  participant W as Web
  participant DB as DB
  participant E as Edge notify

  W->>DB: rpc simplified_debts(group_id)
  DB-->>W: suggested payments
  P->>W: pay Ben 42.50
  W->>DB: rpc settle_up(group_id, to_user, amount_cents, currency, note)
  DB->>DB: require_member, both people in group, amount > 0
  DB->>DB: fx = private.fx_rate(currency, group currency, current_date)
  DB->>DB: insert settlements (from_user = caller)
  DB->>DB: trigger: activity settlement.created
  DB->>DB: trigger: notifications settlement.created<br/>to from_user and to_user, minus the actor
  DB->>E: notify (push)
  DB-->>W: settlements row
  DB-->>W: Realtime: settlements change
  W->>DB: refetch group_balances
```

To undo a mistaken payment, call `delete_settlement(id)`. It is a soft delete open to the payer, the recipient, whoever recorded it, or an admin.

## Simplified debts

`simplified_debts` always simplifies. The client reads `groups.simplify_debts` to decide whether to show the simplified list or plain pairwise balances. `simplifyDebts()` in core runs the same greedy algorithm, so the client can preview without a round trip and tests can compare both.

```mermaid
sequenceDiagram
  autonumber
  participant W as Web
  participant DB as DB
  participant V as group_balances view

  W->>DB: rpc simplified_debts(group_id)
  DB->>DB: require_member(group_id)
  DB->>V: select user_id, net_cents for the group
  Note over V: each expense converted once to group currency,<br/>payer credited, total spread over splits<br/>by largest remainder, settlements applied
  V-->>DB: creditors (net > 0) and debtors (net < 0), by user id
  loop until no creditor or no debtor is left
    DB->>DB: pick largest creditor and largest debtor<br/>(ties: smallest user id)
    DB->>DB: pay = least(credit, debt), subtract from both
    DB-->>W: row (from_user, to_user, amount_cents)
  end
```

For n people with a non-zero balance the result has at most n - 1 payments.

## Plan an event

Creating a poll is a plain insert, checked by RLS (`events: members create` requires membership, `created_by = auth.uid()` and `status = 'polling'`). Everything that changes `status` goes through an RPC.

```mermaid
sequenceDiagram
  autonumber
  actor O as Organizer
  participant W as Web
  participant C as core
  participant DB as DB
  participant E as Edge notify

  O->>W: title, date window, day hours, slot size,<br/>duration, min attendees, time zone
  W->>C: eventCreateSchema.parse(input)
  Note over C: window at most 62 days, slot 15, 30 or 60 minutes
  W->>DB: insert into events (PostgREST, RLS checked)
  DB->>DB: check constraints and private.is_time_zone(timezone)
  DB->>DB: trigger: activity event.created
  DB->>DB: trigger: notifications event.created to members
  DB->>E: notify (push)
  DB-->>W: events row
```

## Request availability

```mermaid
sequenceDiagram
  autonumber
  actor O as Organizer
  participant W as Web
  participant DB as DB
  participant E as Edge notify

  O->>W: nudge people who have not answered
  W->>DB: rpc request_availability(event_id, user_ids or null)
  DB->>DB: require_user, member_event, status must be polling
  alt user_ids null or empty
    DB->>DB: targets = members without availability rows,<br/>not the caller, not closed accounts
  else explicit list
    DB->>DB: every id must be a member (else member_not_found)
  end
  DB->>DB: upsert availability_requests (responded_at = null)
  DB->>DB: insert notifications availability.requested
  DB->>E: notify, once per target (push)
  DB->>DB: activity availability.requested
  DB-->>W: number of people asked
```

## Paint availability and the live heatmap

Each person sends their whole set of cells for the event in one call. The server replaces that person's rows, so the client never has to diff.

```mermaid
sequenceDiagram
  autonumber
  actor A as Ava
  participant WA as Ava's web
  participant C as core
  participant DB as DB
  participant RT as Realtime
  participant WB as Ben's web

  WB->>RT: subscribe channel plan:eventId<br/>availability, events, event_rsvps, activity
  WA->>C: buildSlots(window, day hours, slot size, event time zone)
  C-->>WA: grid of UTC slot starts (DST aware)
  A->>WA: drag to paint yes, maybe or erase
  WA->>DB: rpc set_availability(event_id, [{slot_start, level}])
  DB->>DB: status polling, at most 5000 slots
  DB->>DB: each slot_start, read at time zone events.timezone,<br/>must be a grid cell (else invalid_slot)
  DB->>DB: delete caller's rows, insert new rows
  DB->>DB: availability_requests.responded_at = now()
  DB-->>WA: slots saved
  DB-->>RT: WAL changes on availability
  RT->>RT: apply Ben's RLS select policy
  RT-->>WB: postgres_changes
  WB->>WB: batch for 300 ms, then invalidate<br/>availability, best slots, requests
  WB->>DB: select availability for event
  WB->>C: heatLevels(counts per cell, member count)
  C-->>WB: levels 0 to 4 for the heat cells
```

## Best slots and scheduling

`best_slots` ranks start times with the same rules as `rankSlots()` in core: a duration covers `ceil(duration / slot)` cells, a person counts as yes only if they marked yes on every cell, as maybe if every cell is yes or maybe, and `score = yes + 0.5 * maybe`.

```mermaid
sequenceDiagram
  autonumber
  actor O as Organizer
  participant W as Web
  participant DB as DB
  participant E as Edge notify
  actor M as Members

  W->>DB: rpc best_slots(event_id, limit 5)
  DB->>DB: candidates = distinct slot_start of current members
  DB->>DB: per candidate and member: cells covered, all yes?
  DB->>DB: keep yes + maybe >= min_attendees,<br/>order by score desc, then earliest, cap 100
  DB-->>W: starts_at, ends_at, yes_count, maybe_count, score, missing
  O->>W: lock in the top slot
  W->>DB: rpc schedule_event(event_id, starts_at)
  DB->>DB: manageable_event: owner, admin or creator
  DB->>DB: status polling or scheduled (reschedule)
  DB->>DB: update events: scheduled, starts_at,<br/>ends_at = starts_at + duration, reminder_sent_at = null
  DB->>DB: trigger: activity event.scheduled
  DB->>DB: trigger: notifications event.scheduled to members
  DB->>E: notify (push)
  DB-->>W: events row
  M->>DB: insert or update event_rsvps (going, maybe, declined)
  Note over DB: hourly job sends event.reminder<br/>and rsvp.reminder within 24 hours of the start
```
