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
