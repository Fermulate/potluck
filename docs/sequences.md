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
- [Add someone who is not on Potluck yet, and their claim](#add-someone-who-is-not-on-potluck-yet-and-their-claim)
- [Friend links, removing and blocking](#friend-links-removing-and-blocking)
- [Delete and restore a group](#delete-and-restore-a-group)
- [Group notes](#group-notes)
- [Add an expense](#add-an-expense)
- [Scan a receipt and attach files](#scan-a-receipt-and-attach-files)
- [Settle up](#settle-up)
- [Settle with a friend across groups](#settle-with-a-friend-across-groups)
- [Remind someone who owes you](#remind-someone-who-owes-you)
- [Simplified debts](#simplified-debts)
- [Plan an event](#plan-an-event)
- [Request availability](#request-availability)
- [Paint availability and the live heatmap](#paint-availability-and-the-live-heatmap)
- [Guest availability links](#guest-availability-links)
- [Best slots and scheduling](#best-slots-and-scheduling)
- [Recurring expenses](#recurring-expenses)
- [Import a spreadsheet](#import-a-spreadsheet)
- [Daily FX sync](#daily-fx-sync)
- [Notification settings, email and the monthly summary](#notification-settings-email-and-the-monthly-summary)
- [Delete an account](#delete-an-account)
- [Two-step sign in](#two-step-sign-in)
- [Deploy pipeline](#deploy-pipeline)

## Sign up and profile creation

Nobody writes to `profiles` on sign up. The `on_auth_user_created` trigger does it in the same transaction as the auth user, so a profile always exists for a signed-in user. The web app then sends every new account through `/welcome` (name, avatar, time zone, currency) until the auth user carries `onboarded: true` in its metadata; the `_app` layout and the auth callback both check that flag, so it holds for magic links and OAuth too.

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
    A-->>W: redirect to /auth/callback with a session
  else local stack (confirmations off)
    A-->>W: session right away
  end
  W->>W: user_metadata.onboarded missing, go to /welcome
  U->>W: name, avatar, time zone, currency
  W->>DB: update own profile (RLS: id = auth.uid())
  W->>A: auth.updateUser(data: onboarded = true)
  W->>W: continue to the redirect target, default /home
```

## Create a group and invite people

`create_group_v2` (type and trip dates; `create_group` for older clients) and `create_invite` are security definer RPCs because groups have no insert policy. The deferred `group_members_owner_check` trigger checks at commit that the new group has exactly one owner.

```mermaid
sequenceDiagram
  autonumber
  actor O as Owner
  participant W as Web
  participant DB as DB

  O->>W: name, type (and trip dates), emoji, color, currency
  W->>DB: rpc create_group_v2(name, emoji, color, currency, type, starts_on, ends_on)
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

The join page works before sign in. It calls `invite_preview_v2` (anon may execute it, like `invite_preview` before it), which only returns what the join page needs: group name, look, member count and up to five first names, plus the saved seat for a claim link (next section).

```mermaid
sequenceDiagram
  autonumber
  actor G as Invitee
  participant W as Web
  participant A as Auth
  participant DB as DB
  participant E as Edge notify

  G->>W: open /join/:code
  W->>DB: rpc invite_preview_v2(code) as anon
  DB-->>W: name, emoji, member_count, first_names,<br/>status (valid, expired, revoked, used_up, archived, blocked), is_member
  alt not signed in
    W->>A: sign up or sign in, redirect back to /join/:code
  end
  G->>W: Join
  W->>DB: rpc accept_invite(code)
  DB->>DB: require_user(), lock invite row (for update)
  alt already a member
    DB-->>W: group_id (invite not used up)
  else checks fail
    DB-->>W: invite_revoked, invite_expired, invite_used_up,<br/>invite_wrong_email, group_archived or blocked
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

## Add someone who is not on Potluck yet, and their claim

Ava adds "Sam (sam@example.com)" to a group. Sam is a placeholder profile with no auth user ([ADR 19](adr/0019-placeholder-members-and-claiming.md)): a plain member who can pay, be in splits and be paid, but never signs in, gets push or an inbox. When Sam confirms that email, or opens his claim link, everything that names the placeholder is moved to his account.

```mermaid
sequenceDiagram
  autonumber
  actor A as Ava
  actor S as Sam
  participant W as Web
  participant Au as Auth
  participant DB as DB
  participant E as Edge notify

  A->>W: Members, Add someone (name, email)
  W->>DB: rpc add_placeholder_member(group_id, 'Sam', email)
  DB->>DB: require_can_add_people (member, open, may invite)<br/>placeholder_exists, too_many_invites
  DB->>DB: insert profiles (is_placeholder), placeholders (email),<br/>group_invites (placeholder_id, email, max_uses 1)
  DB->>DB: insert group_members (role member)<br/>trigger: activity member.added (actor Ava)
  DB->>DB: trigger: notify member.added to Sam<br/>notifications_skip_placeholders keeps only this type<br/>channels: email only (never push)
  DB-->>W: placeholder id
  Note over DB,E: send_email_notifications (cron) sends the invite to placeholders.email<br/>with claim_code; one reminder later via remind_placeholder
  A->>W: add expense split with Sam (ordinary member)
  alt Sam signs up with that email
    S->>Au: sign up, confirm email
    Au->>DB: insert or update auth.users (email_confirmed_at)
    DB->>DB: on_auth_user_created: profiles row for Sam
    DB->>DB: on_auth_user_verified: claim_placeholder(ph, Sam, announce)<br/>for each waiting seat with that email (errors swallowed)
  else Sam opens his claim link
    S->>W: /join/:code (invite_preview_v2 shows "a seat saved for Sam")
    W->>DB: rpc accept_invite(code)
    DB->>DB: email matches the link's, email confirmed,<br/>uses + 1, claim_placeholder(ph, Sam)
  end
  DB->>DB: lock group row for no key update<br/>refuse if Sam is or was in the group, or is blocked there
  DB->>DB: potluck.claiming on: rewrite every FK to profiles,<br/>activity data, notification payloads, default split,<br/>recurring templates, expense_items.user_ids
  DB->>DB: befriend the group, delete the placeholder,<br/>activity member.claimed, member.joined to owner, admins, Ava
  DB-->>W: group_id: Sam sees the group, history and balance
```

## Friend links, removing and blocking

```mermaid
sequenceDiagram
  autonumber
  actor A as Ava
  actor C as Cleo
  participant W as Web
  participant DB as DB

  A->>W: Friends, Add a friend
  W->>DB: rpc my_friend_link() (or create_friend_invite(email))
  DB-->>W: code (email invites open Ava's own mail app)
  C->>W: /friend/:code
  W->>DB: rpc friend_invite_preview(code) as anon
  DB-->>W: Ava's first name, avatar, status
  C->>W: Add Ava as a friend
  W->>DB: rpc accept_friend_invite(code)
  DB->>DB: checks (revoked, expired, used up, email, block)<br/>friendships both ways, notify friend.added to Ava
  A->>W: friend page, Remove friend or Block
  W->>DB: rpc remove_friend(id) (refused with an open 1:1 balance)<br/>or rpc block_user(id) (friendship gone both ways)
  Note over DB: a block is never announced (refusals read like a dead link or a stranger)<br/>and mutes: no notification whose actor Ava blocked reaches her
```

## Delete and restore a group

Deleting stamps the group instead of removing it ([ADR 20](adr/0020-group-types-restorable-deletes-and-shared-notes.md)). The policy helpers leave a stamped group out, so it vanishes from every screen at once; any member can bring it back for 30 days, then the nightly job removes it for good.

```mermaid
sequenceDiagram
  autonumber
  actor O as Owner
  actor M as Member
  participant W as Web
  participant DB as DB
  participant C as pg_cron

  O->>W: Settings, Delete group, confirm
  W->>DB: rpc delete_group(group_id)
  DB->>DB: require_member (owner), lock group row
  Note over DB: direct groups raise direct_group_not_deletable;<br/>group_has_balances while any balance or pairwise debt remains
  DB->>DB: groups.deleted_at = now(), deleted_by
  DB->>DB: open group_invites and event_guest_links revoked_at = same now()
  DB->>DB: activity group.deleted
  DB->>DB: notify other members group.deleted (deleted_group_id, group_name)
  DB-->>W: ok
  W-->>O: toast with Undo, back to Groups
  Note over DB: my_group_ids, is_group_member, is_group_admin,<br/>group_role, require_member skip deleted groups.<br/>Expense and member inserts raise group_deleted,<br/>notifications about it are dropped

  M->>W: Groups, Recently deleted
  W->>DB: rpc my_deleted_groups()
  DB-->>W: rows with deleted_at, deleted_by, purge_after
  M->>W: Restore
  W->>DB: rpc restore_group(group_id)
  DB->>DB: caller is in group_members, lock group row
  Note over DB: group_not_found once deleted 30 days ago or more
  DB->>DB: reopen invites and guest links revoked at deleted_at
  DB->>DB: deleted_at = null, activity group.restored, notify group.restored
  DB-->>W: groups row
  W-->>M: opens the group

  C->>DB: 03:20 UTC private.purge_deleted_groups()
  DB->>DB: delete groups still deleted more than 30 days ago (cascade)
```

## Group notes

The notes are one row per group in `group_whiteboards`, published to realtime. Saves carry the version the editor started from, so two people typing at once never overwrite each other silently.

```mermaid
sequenceDiagram
  autonumber
  actor A as Ava
  actor B as Ben
  participant WA as Web (Ava)
  participant WB as Web (Ben)
  participant DB as DB
  participant RT as Realtime

  WA->>DB: select group_whiteboards (body, version 3)
  WB->>DB: select group_whiteboards (body, version 3)
  A->>WA: types, pauses
  WA->>DB: rpc save_group_whiteboard(group_id, body, base_version 3)
  DB->>DB: require_member, require_group_open, lock row
  DB->>DB: version 3 matches: body, version 4, updated_by
  DB->>DB: activity group.notes_updated (one line per sitting)
  DB-->>WA: row, version 4
  DB-->>RT: group_whiteboards UPDATE
  RT-->>WB: change (RLS: members, two-step done)
  WB->>DB: refetch
  alt Ben has not typed
    WB-->>B: shows Ava's text
  else Ben was typing
    WB-->>B: Ava saved a newer version: use theirs or keep mine
    B->>WB: keep mine
    WB->>DB: rpc save_group_whiteboard(..., base_version 4)
  end
  Note over DB: a stale base_version raises whiteboard_conflict
```

## Add an expense

The client previews the split and checks who paid with `@potluck/core` so people see exact cents while typing. The server does not trust that preview. For `equal`, `percent`, `shares` and `adjustment` it recomputes the splits from the people, weights and adjustments; for a by-item bill sent with `items` it works out the shares from the items. Only `exact` (and `itemized` from older clients) use the client's `share_cents`, and those must add up to the amount. The payers must add up to the amount too ([ADR 12](adr/0012-several-payers-refunds-and-stored-items.md)).

The form starts in the currency the viewer last used in the group (`fetchLastCurrency`) and from the group's default split (`groups.default_split`). Ticking "Use this split for new expenses" calls `set_default_split` after the expense saves.

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

  P->>W: amount, currency, who paid, split type, people
  W->>C: splitEqual, splitPercent, splitShares, splitAdjustment or splitItemized
  C-->>W: shares in minor units (largest remainder)
  W->>C: checkPayers(amount, payers)
  C-->>W: payers add up, or payers_sum_mismatch (save blocked)
  opt receipt photo
    W->>S: upload receipts/:groupId/:file (policy: member of group)
  end
  W->>DB: rpc create_expense_v2(payload with payers, is_refund, items)
  DB->>DB: share lock the group row, require_member,<br/>payers add up and are in group, split people in group,<br/>receipt_path starts with group_id
  DB->>DB: fx_rate = 1, or private.fx_rate(currency, group currency, spent_at)
  alt no rate yet
    DB-->>W: error fx_rate_unavailable
  end
  DB->>DB: private.compute_split_rows(amount, split_type, splits)<br/>or private.itemized_splits(items, tax, tip, discount)
  opt payload.recurrence
    DB->>DB: insert recurring_expenses (payers kept, next_run_on = spent_at + 1 period)
  end
  DB->>DB: insert expenses (trigger writes paid_by as the one payer)
  DB->>DB: several payers: replace expense_payers rows
  DB->>DB: insert expense_splits, and expense_items for a by-item bill
  DB->>DB: trigger: activity expense.created
  Note over DB: at commit (deferred constraint triggers)
  DB->>DB: check_expense_splits() and check_expense_payers(): sums = amount_cents
  DB->>DB: expenses_notify(): notifications expense.created<br/>to split people and every payer, never the actor
  DB->>DB: notifications_route: channels from notification_prefs<br/>(push, and email when the flag is on)
  DB->>E: notifications_push trigger (only when channels has push),<br/>pg_net POST /functions/v1/notify, x-potluck-secret from Vault
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

The service worker shows the message. The PWA is built with `vite-plugin-pwa` in `generateSW` mode, and `apps/web/public/push-sw.js` (pulled in through `workbox.importScripts` in `apps/web/vite.config.ts`) handles `push` by showing a notification and `notificationclick` by focusing or opening the app at the payload's `url`, same origin only. The browser subscribes from the Me page, which stores the endpoint in `push_tokens`; sign out drops that row and the subscription first so the next account on the device does not inherit it.

## Scan a receipt and attach files

Scanning happens on the device and only fills the form; the expense is saved by the same `create_expense_v2` call as above ([ADR 21](adr/0021-receipt-scanning-and-attachments.md)).

```mermaid
sequenceDiagram
  actor P as Person
  participant W as Web (expense form)
  participant SW as Service worker
  participant O as OCR worker (tesseract.js)
  participant C as core
  participant S as Storage (receipts)
  participant DB as DB

  P->>W: Scan a receipt, pick or take a photo
  W->>W: preview and OCR from the original photo,<br/>prepareImage (2000 px JPEG) only for upload
  W->>W: import("tesseract.js") (lazy chunk)
  W->>O: createWorker(eng, LSTM only) from /ocr/<version>/
  O->>SW: worker.min.js, core .wasm.js, eng.traineddata.gz
  alt first scan
    SW->>SW: fetch from our origin, keep in cache potluck-ocr
  else later scans, online or not
    SW-->>O: from cache
  end
  O-->>W: text from a lossless grayscale copy (ocrImage pass 1)
  W->>C: parseReceipt(text): itemsMatch?
  opt items do not come to the total
    W->>O: read again from an enlarged copy (pass 2), keep the better reading
  end
  O-->>W: worker terminated
  C-->>W: merchant, date, currency, total, items, tax, tip, discount, itemsMatch
  W->>P: review sheet: the photo, one box per part, editable prices, a warning if off
  P->>W: Fill in the expense
  W->>W: description, date, amount, by-item draft (everyone on every line),<br/>photo added to the attachments (nothing saved)
  P->>W: pick who had what, add more files, Save
  par each new file
    W->>S: upload receipts/:groupId/:file (policy: member, two-step done)
  end
  W->>DB: rpc create_expense_v2(payload, receipt_path = first file)
  DB->>DB: trigger: expense_attachments row 0 = receipt_path
  opt more than one file (or an edit changed them)
    W->>DB: rpc set_expense_attachments(id, paths in order)
    DB->>DB: group share lock, member, own expense or admin,<br/>paths in the group folder and uploaded, five at most
    DB->>DB: rewrite expense_attachments, receipt_path = first,<br/>activity expense.updated {attachments: {from, to}}
    W->>S: remove files that left the list, and unused uploads (uploader or admin only)
  end
  Note over W,S: a failed save keeps its uploads for the retry;<br/>closing the form deletes them
  DB-->>W: Realtime: expenses change
  W->>W: invalidate the expense (its attachments key sits under it)
```

Daily, `receipts-sweep` (pg_cron, then the edge function with the shared secret) deletes files older than a day that no expense or attachment names, through the Storage API.

On the expense page each photo opens full screen through a signed URL (one hour), with pinch, double tap and button zoom and a swipe to the next one. Members of other groups get no rows from `expense_attachments` and no object from the bucket.

## Settle up

A member records a payment they are part of, in either direction ("I paid Ben", "Ben paid me"); owners and admins also between two others. The day defaults to today; a past day keeps that day's FX rate. If the recipient saved payment methods, the payer can open their app first (ADR 15): Potluck builds the link on the client and records nothing until the payer confirms.

```mermaid
sequenceDiagram
  autonumber
  actor P as Payer
  participant W as Web
  participant App as Payment app
  participant DB as DB
  participant E as Edge notify

  W->>DB: rpc simplified_debts(group_id) (or pairwise in core)
  DB-->>W: suggested payments
  W->>DB: select payment_methods where user_id = Ben<br/>(RLS: shares a group, no block)
  opt pay with an app
    P->>W: Pay with PayPal
    W->>App: open paypal.me/ben/42.50USD (built by paymentAction)
    P->>W: "Did it go through?" yes
  end
  W->>DB: rpc settle_up_v2(group_id, from_user, to_user,<br/>amount_cents, currency, note, settled_on)
  DB->>DB: share lock the group row, require_member, require_unarchived
  DB->>DB: private.check_payment: amount, two people,<br/>members only for themselves, both in group
  DB->>DB: fx = private.fx_rate(currency, group currency, settled_on or today)
  DB->>DB: insert settlements (settled_at: now, or noon UTC of settled_on)
  DB->>DB: trigger: activity settlement.created
  DB->>DB: trigger: notifications settlement.created<br/>to from_user and to_user, minus the actor
  DB->>E: notify (push)
  DB-->>W: settlements row
  DB-->>W: Realtime: settlements change
  W->>DB: refetch group_balances
```

`update_settlement(id, payload)` edits a payment and `delete_settlement(id)` soft deletes it; `restore_settlement(id)` brings it back. All three are open to the payer, the recipient, whoever recorded it, or an admin. Anything that would move the balance of someone who has left is refused (`member_not_in_group`); the note stays editable. Each change logs `settlement.updated`, `settlement.deleted` or `settlement.restored` in the activity feed and notifies the other people in the payment (a note-only edit is logged, not notified).

## Settle with a friend across groups

One tap squares two people in every group they share (ADR 15). Each group keeps its own payment in its own currency, so balances stay per group.

```mermaid
sequenceDiagram
  autonumber
  actor A as Ava
  participant W as Web (Friends)
  participant DB as DB

  W->>DB: rpc friend_balances()
  DB->>DB: for each of Ava's groups, private.group_debts(group)<br/>(simplified_debts or pairwise_debts, as the group says)
  DB-->>W: (friend_id, group_id, currency, net_cents, archived) rows
  W->>W: friendTotals(): per friend and currency
  A->>W: Settle up with Ben, Record 3 payments
  W->>DB: rpc settle_with_friend(ben, settled_on, note)
  DB->>DB: lock every shared group row for no key update, in id order
  loop each shared group, open, both still members
    DB->>DB: debt between Ava and Ben from private.group_debts
    DB->>DB: insert settlements (group currency, rate 1)
  end
  DB-->>W: the payments made
```

`settle_all(group_id)` does the same inside one group for every debt the caller is in ("Settle everything" on the Balances tab).

## Remind someone who owes you

```mermaid
sequenceDiagram
  autonumber
  actor A as Ava (owed)
  participant W as Web (Balances)
  participant DB as DB
  participant E as Edge notify

  A->>W: Remind Ben
  W->>DB: rpc remind_debt(group_id, ben)
  DB->>DB: require_member, require_group_open,<br/>Ben owes Ava per private.group_debts
  DB->>DB: insert debt_reminders on conflict do nothing<br/>(unique pair, UTC day)
  alt already sent today
    DB-->>W: already_reminded
  else first today
    DB->>DB: notifications debt.reminder to Ben
    DB->>E: notify (push, opens settle up with Ava picked)
    DB-->>W: reminder row
  end
```

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
  Note over V: each expense converted once to group currency,<br/>total spread over payers (credit) and splits (debit)<br/>by largest remainder, refunds flipped, settlements applied
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

## Guest availability links

A member shares a link; someone without an account opens `/a/<code>`, types a name and paints. Guests never sign in: two `anon` RPCs check the link on every call, and a token kept in the guest's browser (stored as a sha256 on the server) lets them edit their own answer later. See [ADR 16](adr/0016-guest-availability-links.md).

```mermaid
sequenceDiagram
  autonumber
  actor M as Member
  participant WM as Member's web
  participant DB as DB
  participant RT as Realtime
  actor G as Guest
  participant WG as Guest's browser

  M->>WM: Share with guests, pick 24 hours, 7 days or 30 days and a guest cap
  WM->>DB: rpc create_guest_link(event_id, ttl, max_guests)
  DB->>DB: member, group open, plan polling, under 20 open links
  DB-->>WM: event_guest_links row with a random code
  M->>G: sends /a/code (copy or the share sheet)
  G->>WG: opens /a/code, signed out
  WG->>WG: read token for this code from localStorage (maybe none)
  WG->>DB: rpc guest_link_preview(code, token) as anon
  DB->>DB: status: revoked, removed, expired, archived,<br/>scheduled (only to a guest who answered),<br/>closed (not polling), full, or open
  DB-->>WG: title, emojis, host first name, grid,<br/>heat counts per slot (no names), own answer if the token matches
  G->>WG: types a name, paints yes or maybe
  WG->>DB: rpc set_guest_availability(code, name, token, slots) as anon
  DB->>DB: lock the link row, same checks, name 1 to 40 chars,<br/>slots must be grid cells
  alt token matches a guest on this link
    DB->>DB: rate limit 60 saves per hour, rename, replace slots
  else new guest
    DB->>DB: at least one slot, a free seat (else guest_link_full),<br/>under 20 new guests per 10 minutes
    DB->>DB: insert event_guests with sha256(new token)
  end
  DB-->>WG: guest_token, saved
  WG->>WG: keep token and name in localStorage
  DB-->>RT: WAL changes on event_guest_availability
  RT-->>WM: postgres_changes (members' RLS)
  WM->>DB: select event_guests, event_guest_availability, best_slots
  WM->>WM: heatmap and best times with the guest tagged
  opt organizer cleans up
    M->>DB: rpc remove_guest_answer(guest_id) or revoke_guest_link(link_id)
  end
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
  DB->>DB: candidates = distinct slot_start of current members and guests
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

## Recurring expenses

Adding `recurrence` to a `create_expense` payload writes the first expense and a `recurring_expenses` template whose `next_run_on` is one period after `spent_at`. From then on pg_cron does the work.

```mermaid
sequenceDiagram
  autonumber
  participant CR as pg_cron
  participant DB as DB
  participant E as Edge notify

  CR->>DB: 00:10 UTC: private.materialize_recurring_expenses(current_date)
  DB->>DB: collect active templates with next_run_on <= today
  DB->>DB: share lock their group rows, in group id order
  loop each template (own exception block)
    DB->>DB: lock and re-read the template,<br/>for update skip locked (skip if taken or no longer due)
    alt group archived, payer or a split person left<br/>or closed their account
      DB->>DB: active = false, skip
    else
      DB->>DB: anchor_day = the stored anchor_day,<br/>else the day of the series' first expense
      loop while due <= today and runs < 12
        DB->>DB: fx = private.fx_rate(currency, group currency, due)
        break fx is null
          Note over DB: template stays due,<br/>tomorrow's run retries
        end
        DB->>DB: insert expenses (spent_at = due, recurring_id,<br/>tax, tip, discount for a by-item bill)
        DB->>DB: insert expense_items from the template's items (if any)
        DB->>DB: insert expense_payers from the template's payers (if several)
        DB->>DB: insert expense_splits from private.compute_split_rows()
        DB->>DB: due = next week, two weeks on, or next month or year<br/>on anchor_day clamped to month end
      end
      DB->>DB: update next_run_on = due
    end
  end
  Note over DB: at commit: splits and payers sum checks,<br/>expense.created notifications
  DB->>E: notify (push) per notification
```

`nextOccurrence()` in core computes the same dates (Jan 31, Feb 28, Mar 31), so the UI can show when a series runs next.

### Changing, skipping and starting a series

A template only shapes the copies still to come ([ADR 14](adr/0014-editable-recurring-templates.md)). The web app opens it at `/recurring/$recurringId` in the expense form; the expense page shows the series a copy belongs to, or "Make it repeat".

```mermaid
sequenceDiagram
  autonumber
  participant U as Web app
  participant DB as DB
  participant CR as pg_cron

  U->>DB: rpc update_recurring_expense(id, payload)
  DB->>DB: share lock group, require member, not archived
  DB->>DB: admin or anyone it involves, else not_allowed
  DB->>DB: merge with the stored template, check payers,<br/>split (compute_split_rows) or items (itemized_splits)
  alt money changed and someone named has left
    DB-->>U: payer_not_in_group / split_member_not_in_group
  else
    DB->>DB: update template (anchor_day follows a new date),<br/>activity recurring.updated
    DB-->>U: template
  end

  U->>DB: rpc skip_recurring_expense(id)
  DB->>DB: next_run_on = recurring_step(next_run_on), activity recurring.skipped

  U->>DB: rpc make_expense_recurring(expense_id, recurrence)
  DB->>DB: refuse refunds, deleted, already repeating, someone left
  DB->>DB: insert template from the expense's payers, split, items
  DB->>DB: next_run_on = recurring_next_from(spent_at, recurrence, day, today)
  DB->>DB: expenses.recurring_id = template, activity recurring.created

  CR->>DB: at :05 and :35: private.send_recurring_heads_ups(now())
  loop templates due within 2 days, active, group open, nobody left
    loop payers and people with a share, not yet told about this date
      alt 09:00 on their local day before has come, and it is before 00:10 UTC on the date
        DB->>DB: notify recurring.upcoming (share, posts_on, deadline, their zone,<br/>quiet if 22:00 to 07:00 there: inbox only); insert private.recurring_heads_ups
      end
    end
  end
  Note over DB: routed by the Reminders setting:<br/>inbox always, push and email per person
```

## Import a spreadsheet

A Splitwise export or a Potluck spreadsheet comes into one group, up to 5,000 rows per transaction ([ADR 18](adr/0018-export-backup-and-import.md)). Everything up to the button press happens in the browser; the server writes every row or none.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant W as Web
  participant K as Worker
  participant DB as DB

  U->>W: choose a CSV (group settings, Import)
  alt large file
    W->>K: text and column names
    K-->>W: readImportFile: people, rows, totals, issues
  else small file
    W->>W: readImportFile
  end
  W->>W: guessMapping(people, members and people who left)
  W->>DB: fx_rates history for each other currency, earlier imports (activity)
  U->>W: confirm or change who is who, type missing rates, leave rows out
  W->>W: planImport: rows with their rates, balances in the group currency,<br/>total line check, rows already in the group, payments paymentProblem refuses
  U->>W: Import N rows
  loop every 5,000 rows (one import each)
    opt more than 2,000 rows
      W->>DB: rpc import_stage(batch_id, group_id, 2,000 rows) until 2,000 or fewer are left
    end
    W->>DB: rpc import_expenses(group_id, rest, source, batch_id, fingerprint)
    DB->>DB: lock group row (share), require_member, require_unarchived
    DB->>DB: read every row into working tables, find the first failing row<br/>(save_expense's checks, check_payment for payments)
    alt a row fails
      DB-->>W: the error code, hint import_row:n (nothing written)
      W-->>U: Row (file line): message, and what earlier imports wrote
    else every row passes
      DB->>DB: set potluck.importing = group id
      DB->>DB: insert expenses, payers, splits, settlements (one statement each)
      Note over DB: activity and notification rows for this group<br/>are dropped by the hold_during_import triggers
      DB->>DB: log_activity expenses.imported {expenses, payments, source, fingerprint}
      DB-->>W: {expenses, payments}
    end
  end
  W->>W: invalidate the group's money, go to its expenses
```

## Daily FX sync

```mermaid
sequenceDiagram
  autonumber
  participant CR as pg_cron
  participant DB as DB
  participant V as Vault
  participant N as pg_net
  participant E as Edge fx-sync
  participant FR as Frankfurter

  CR->>DB: 16:30 UTC: private.invoke_edge_function('fx-sync')
  DB->>V: read project_url, edge_secret
  alt either secret missing (local, CI)
    DB-->>CR: return, no call
  else
    DB->>N: net.http_post(project_url/functions/v1/fx-sync,<br/>x-potluck-secret, timeout 5 s)
    N->>E: POST
    E->>E: hasEdgeSecret() or 403
    E->>FR: GET /v1/latest?base=EUR&symbols=USD,GBP,...
    FR-->>E: { date, rates per EUR }
    E->>E: cross rates for every pair of 28 currencies,<br/>12 decimals
    E->>DB: upsert fx_rates in batches of 1000 (service role)
  end
```

To backfill, call the function with `?from=YYYY-MM-DD` and the secret header. It fetches the range from Frankfurter and upserts every day in it.

## Notification settings, email and the monthly summary

Every notification lands in the inbox. Where else it goes is decided once, when the row is inserted, from the person's settings ([ADR 11](adr/0011-notification-prefs-and-email.md)). Email waits a minute in an outbox so quick fixes fold into one message.

```mermaid
sequenceDiagram
  autonumber
  actor U as Person
  participant W as Web
  participant DB as DB
  participant CR as pg_cron
  participant E as Edge notify
  participant R as Resend
  participant UF as Edge unsubscribe

  U->>W: Me page, "What to hear about": Payments push off
  W->>DB: rpc set_notification_pref('payments', push := false)
  Note over DB: later, someone settles up with U
  DB->>DB: insert notifications settlement.created
  DB->>DB: notifications_route (before insert):<br/>channels = notification_channels(user, type)
  DB->>DB: notifications_push: no push in channels, no call
  DB-->>W: Realtime: notifications insert, inbox shows it
  opt email in channels (app_config.email_notifications on, setting on)
    DB->>DB: notifications_queue_email: private.email_outbox<br/>(subject = expense id for expense types)
    CR->>DB: every minute: send_email_notifications()
    DB->>DB: subjects quiet for 60 s; fold per expense<br/>(added and deleted inside the hold: nothing),<br/>re-check settings, mark sending in batches of 50
    DB->>E: POST notify { batch, emails } per batch (names,<br/>current amounts, signed unsubscribe tokens)
    E-->>DB: 202 at once, keeps sending in the background
    E->>R: POST /emails/batch, Idempotency-Key = batch id,<br/>List-Unsubscribe and List-Unsubscribe-Post headers
    alt 429 or 5xx
      E->>R: retry with backoff (Retry-After), up to 4 tries
    end
    E->>DB: rpc email_outbox_report(batch, delivered)<br/>sent, or pending again with backoff (failed after 5)
    Note over DB: no report in 10 minutes: the next run sends<br/>the same rows under the same batch id (the provider drops<br/>a copy), or any changed set under a new one
  end
  alt mail client one-click
    R-->>UF: POST /functions/v1/unsubscribe?token=...
    UF->>DB: rpc email_unsubscribe(token, 'unsubscribe') as anon
  else footer link
    U->>W: /unsubscribe?token=...
    W->>DB: rpc email_unsubscribe(token, 'preview'): category, masked email
    U->>W: tap Unsubscribe
    W->>DB: rpc email_unsubscribe(token, 'unsubscribe')<br/>("Keep sending them" calls 'undo')
  end
  DB->>DB: check HMAC, snapshot the settings it changes<br/>(only if one was on),<br/>set notification_prefs.email = false
```

On the first of the month at 15:00 UTC the `monthly-summary` job runs `private.send_monthly_summaries()`: everyone with a non-zero balance in a group they are in gets one `summary.monthly` notification whose data is `private.monthly_summary(uid, month)` (each group with a balance or activity that month, balance in group currency). It is an inbox card and never a push; with email on it goes through the same outbox. Running it twice for a month skips people who already have theirs.

## Delete an account

The profile is never deleted. Other people's balances still reference it, and the money tables use `on delete restrict`, so the account becomes a tombstone named "Former member".

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant W as Web
  participant E as Edge delete-account
  participant DB as DB
  participant A as Auth admin

  U->>W: confirm delete
  W->>E: POST /functions/v1/delete-account (Authorization: user JWT)
  E->>E: gateway verify_jwt, then auth.getUser()
  E->>DB: rpc delete_my_account() as the user
  DB->>DB: lock the row of every group the user is in, in id order
  DB->>DB: owned groups: hand to oldest active admin, else oldest active member,<br/>delete the group if nobody else active is left
  DB->>DB: pause recurring templates the user pays or shares (open groups)
  DB->>DB: leave groups where balance is 0,<br/>keep memberships with open balances
  DB->>DB: delete push_tokens, calendar_connections, busy_blocks,<br/>notifications, availability, requests, RSVPs,<br/>friendships, blocks
  DB->>DB: revoke open invites the user created<br/>(seat claim links stay open)
  DB->>DB: profile: Former member, avatar_path null,<br/>timezone UTC, locale en, deleted_at now()
  DB-->>E: ok
  E->>A: auth.admin.deleteUser(id, shouldSoftDelete = true)
  A-->>E: ok
  E-->>W: { ok: true }
  W->>W: sign out, go to landing
```

After this every RPC answers `account_deleted` for that id, and closed accounts never receive notifications. The edge function also deletes the avatar files, and a trigger drops the calendar feed token.

## Two-step sign in

Set up from Me (Supabase Auth TOTP), enforced by the database ([ADR 13](adr/0013-two-step-sign-in-enforced-in-the-database.md)). Any first step (password, magic link, Google or Apple) ends in an `aal1` session; only a code makes it `aal2`.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant W as Web
  participant A as Auth
  participant DB as DB
  participant E as Edge mfa-recover

  Note over U,DB: Setup, on Me
  W->>A: mfa.enroll(totp), after dropping any unfinished one
  A-->>W: QR code and secret
  U->>W: first code from the app
  W->>A: mfa.challengeAndVerify(code)
  A-->>W: session upgraded to aal2
  W->>DB: rpc create_mfa_recovery_codes() (aal2 only)
  DB-->>W: ten codes, stored as SHA-256
  Note over U,DB: Signing in later
  U->>W: password (or link, or OAuth)
  A-->>W: aal1 session
  W->>W: _app beforeLoad: needsSecondFactor, go to /two-factor
  W->>DB: any REST or RPC call meanwhile
  DB-->>W: mfa_required (pre-request check)
  alt code from the app
    U->>W: 6-digit code
    W->>A: mfa.challengeAndVerify
    A-->>W: aal2 session, continue to the redirect
  else phone lost
    U->>W: recovery code
    W->>E: POST mfa-recover (aal1 JWT, code)
    E->>DB: mfa_recovery_code_matches (service role)
    E->>A: admin: delete every factor
    E->>DB: forget_mfa_recovery_codes
    W->>A: refreshSession, no factor left, continue
  end
```

Turning it off asks for a fresh code first (`challengeAndVerify`, then `unenroll`); Supabase refuses to remove a verified factor from an `aal1` session anyway.

## Deploy pipeline

`deploy.yml` runs on pull requests, after every completed CI run on `main` (`workflow_run`) and on manual dispatch. Production jobs only run when that CI run succeeded. `codeql.yml` runs alongside, and CI has to pass before a PR merges (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

```mermaid
sequenceDiagram
  autonumber
  actor D as Developer
  participant GH as GitHub
  participant CI as ci.yml
  participant DP as deploy.yml
  participant SB as Supabase
  participant CF as Cloudflare

  D->>GH: open pull request
  par checks
    GH->>CI: typecheck, lint, test, build
    GH->>CI: supabase start, supabase test db (pgTAP)
  and preview
    GH->>DP: web job (migrate job skipped on PRs)
    DP->>DP: pnpm turbo run build --filter=@potluck/web<br/>with VITE_* repo variables
    DP->>CF: wrangler versions upload --preview-alias pr-N
    CF-->>DP: preview URL for alias pr-N (in the job log)
  end
  D->>GH: merge to main
  GH->>CI: push to main: checks, pgTAP, e2e
  alt CI failed
    CI-->>GH: deploy.yml jobs skip, nothing ships
  else CI passed
  GH->>DP: workflow_run (CI completed, success)
  DP->>SB: migrate job (environment production):<br/>supabase link, db push, config push, functions deploy
  alt migrate failed
    DP-->>GH: stop, web is not deployed
  else success (without Supabase secrets the push step is skipped, the job still succeeds)
    DP->>DP: build web
    DP->>CF: wrangler deploy
    loop up to 6 tries, 10 s apart
      DP->>CF: GET VITE_APP_URL/groups
    end
    CF-->>DP: 200 (SPA fallback) or fail the job
  end
  end
```

The migrations run before the new web build goes out, so the database is never older than the client that talks to it. Additive migrations keep the old client working during the gap.
