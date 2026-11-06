# Security

How Potluck protects its data, what it stores, and where the known weak spots are. To report a vulnerability, follow [SECURITY.md](../SECURITY.md). The mechanics (grants, RLS, definer RPCs, storage policies, edge function auth) are in [architecture.md](architecture.md#security-model).

## Threat model

### What is worth protecting

- **Money history.** Who paid whom, how much, and when. Tampering with it moves real debts between friends.
- **The social graph.** Who is in which group, who is friends with whom, who blocked whom.
- **Plans.** Availability grids and event locations say where people will be and when.
- **Receipts.** Photos can carry addresses, card digits and location metadata.
- **Account data.** Email addresses and display names.

### Who we defend against

| Actor                                   | Can                                                         | Stopped by                                                                                             |
| --------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Anyone on the internet                  | call the API with the publishable key                       | grants: `anon` can read `app_config`, call `invite_preview`, and read the public buckets. Nothing else |
| A signed-in stranger                    | call every RPC, query every table                           | RLS on every table, `require_member()` in every group RPC                                              |
| A group member overreaching             | edit others' expenses, promote themselves, delete the group | role checks inside RPCs and policies, the role matrix in [architecture.md](architecture.md#roles)      |
| A removed or departed member            | keep reading the group                                      | membership is checked on every query. Realtime re-applies RLS per change                               |
| Someone holding an invite link          | see the group name, member count, first names; join         | expiry, max uses, revocation, optional email binding                                                   |
| Someone holding a calendar feed URL     | read the owner's scheduled events                           | 32-character random token, rotatable with `calendar_feed_token(true)`                                  |
| A client with a tampered bundle         | send any payload to any RPC                                 | the server derives splits, FX rates, payer of a settlement and `created_by` itself                     |
| Someone calling edge functions directly | trigger push or FX sync                                     | `x-potluck-secret` shared secret, constant-time compare                                                |

Out of scope: a compromised Supabase or Cloudflare account, a malicious maintainer, and a stolen unlocked phone with an active session.

### Known gaps

These are real today. Each should become an issue.

- **Closed accounts keep their calendar feed.** `delete_my_account()` does not delete the `calendar_feed_tokens` row, and `ics-feed` does not check `profiles.deleted_at`. A closed account that still has an open balance in a group keeps that group's membership, so its old feed URL keeps listing that group's events.
- **Avatar files outlive the account.** The profile's `avatar_path` is cleared, but the file stays in the public `avatars` bucket, at a URL anyone who saw it can still open.
- **Admin invite rule mismatch.** `can()` in core lets admins create admin invites. The server refuses, so this is a UI bug, not a hole.
- **Previews use production data.** PR preview builds point at the production Supabase project. Anyone who can open a PR that gets a preview deploy can ship code that runs against real accounts. Today previews only build for branches in this repository, because fork PRs do not get the Cloudflare secret.
- **Edge function CORS is `*`.** Harmless for the secret- and token-protected functions, and `delete-account` requires a JWT, but it is wider than the app needs.
- **Invite previews show first names** to anyone with the code. That is the point of the join page, but it means an invite link is a small leak of who is in the group.

## Data handling

### What is stored

| Data                                                      | Where                                      | Visible to                                                                 |
| --------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| Email, password hash, sessions                            | `auth.users` (Supabase Auth)               | nobody through the API. Supabase operators                                 |
| Display name, avatar, time zone, locale, default currency | `profiles`                                 | you, people you share a group with or who left one of your groups, friends |
| Groups, members, invites                                  | `groups`, `group_members`, `group_invites` | members. Invites only to admins and the invite's creator                   |
| Expenses, splits, settlements, comments                   | money tables, `comments`                   | members of that group                                                      |
| Availability, RSVPs, events                               | plans tables                               | members of that group                                                      |
| Busy blocks, calendar links                               | `busy_blocks`, `calendar_connections`      | only you. OAuth tokens would live in Vault (feature is off)                |
| Notifications, push subscriptions                         | `notifications`, `push_tokens`             | only you                                                                   |
| Receipts                                                  | private `receipts` bucket                  | members of the group (authenticated download or signed URL)                |
| Avatars, group covers                                     | public buckets                             | anyone with the URL                                                        |

There is no analytics or tracking code in the app.

### What leaves the system

- **Push messages** go through the browser vendor's push service (Google, Mozilla, Apple). Web push payloads are encrypted for the subscribing browser, so the service cannot read the title and body, which may include an expense description or a comment.
- **FX sync** sends nothing about users to Frankfurter. It requests public reference rates.
- **Calendar feeds** contain event titles, descriptions, locations and group names for whoever has the URL.
- **Auth emails** go out through Supabase's SMTP.

## Account deletion

Users close their account from the app, which calls the `delete-account` edge function with their JWT. The flow is drawn in [sequences.md](sequences.md#delete-an-account).

What is removed: push subscriptions, calendar links, busy blocks, notifications, availability, availability requests, RSVPs, friendships, blocks, and memberships in groups where the balance is zero. Open invites the user created are revoked. Groups they owned pass to the longest-standing admin, else the longest-standing member, and are deleted if nobody else is left. The auth user is soft deleted, so the email can no longer sign in.

What stays, and why: the profile row stays as a tombstone named "Former member" with no avatar, because other people's expenses and settlements reference it and their balances must not change. Memberships with an open balance stay so nobody's debt disappears. Expenses, splits, settlements, comments and activity the user took part in stay in their groups.

Closed accounts get `account_deleted` from every RPC and never receive notifications.

## Secrets policy

- **Never commit secrets.** `.env` and `.env.*` are git-ignored (except `.env.example`, which holds no values). The PR template asks every author to check.
- **The publishable key is public.** It ships in the web bundle and in `VITE_*` variables. That is fine, because RLS and grants decide what it can do. Never rely on it being secret.
- **The service role key never leaves Supabase.** Only edge functions use it, through `_shared/admin.ts`, and only after they have authorized the caller. It is never in GitHub, in `.env` files or in the web app.
- **`EDGE_SECRET` lives in two places**: the edge function secrets and the Vault entry `edge_secret`. Rotate both together ([deployment.md](deployment.md#vault-entries)).
- **VAPID private key** is an edge function secret only. Rotating it invalidates every existing push subscription, and browsers have to subscribe again.
- **CI secrets** (listed in [deployment.md](deployment.md#secrets)) are GitHub Actions secrets, scoped as narrowly as the providers allow. Fork PRs do not receive them.
- **If a secret leaks**, rotate it first, then investigate. Report leaks in this repository through private vulnerability reporting.
