-- RPCs: invite links.

create or replace function public.create_invite(
  group_id uuid,
  role public.group_role default 'member',
  max_uses int default null,
  expires_at timestamptz default null,
  email text default null
)
returns public.group_invites
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  my_role public.group_role := private.require_member(create_invite.group_id);
  g public.groups;
  inv public.group_invites;
  wanted public.group_role := coalesce(create_invite.role, 'member');
begin
  select * into g from public.groups x where x.id = create_invite.group_id;

  if g.is_direct then
    raise exception using message = 'Direct groups cannot have invites', hint = 'direct_group', errcode = '23514';
  end if;
  if g.archived_at is not null then
    raise exception using message = 'This group is archived', hint = 'group_archived', errcode = '23514';
  end if;
  if my_role = 'member' and not g.members_can_invite then
    raise exception using message = 'Only admins can invite people to this group', hint = 'not_allowed', errcode = '42501';
  end if;
  if wanted = 'owner' then
    raise exception using message = 'Invites cannot make someone the owner', hint = 'invalid_role', errcode = '22023';
  end if;
  if wanted = 'admin' and my_role <> 'owner' then
    raise exception using message = 'Only the owner can invite admins', hint = 'not_allowed', errcode = '42501';
  end if;
  if create_invite.max_uses is not null and create_invite.max_uses < 1 then
    raise exception using message = 'Max uses must be at least 1', hint = 'invalid_max_uses', errcode = '22023';
  end if;
  if create_invite.expires_at is not null and create_invite.expires_at <= now() then
    raise exception using message = 'Expiry must be in the future', hint = 'invalid_expiry', errcode = '22023';
  end if;

  insert into public.group_invites (group_id, role, max_uses, expires_at, email, created_by)
  values (
    create_invite.group_id,
    wanted,
    create_invite.max_uses,
    create_invite.expires_at,
    nullif(lower(btrim(create_invite.email)), ''),
    auth.uid()
  )
  returning * into inv;

  return inv;
end;
$$;

-- Public data for the join page. Callable without signing in.
-- status is one of: valid, expired, revoked, used_up.
create or replace function public.invite_preview(code text)
returns table (
  group_id uuid,
  name text,
  emoji text,
  color text,
  cover_path text,
  member_count int,
  first_names text[],
  status text,
  is_member boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  inv public.group_invites;
begin
  select * into inv from public.group_invites i where i.code = invite_preview.code;

  if inv.id is null then
    raise exception using message = 'This invite link is not valid', hint = 'invite_not_found', errcode = 'P0002';
  end if;

  return query
  select
    g.id,
    g.name,
    g.emoji,
    g.color,
    g.cover_path,
    (select count(*)::int from public.group_members m where m.group_id = g.id),
    array(
      select split_part(p.display_name, ' ', 1)
      from public.group_members m
      join public.profiles p on p.id = m.user_id
      where m.group_id = g.id and p.deleted_at is null
      order by (m.role = 'owner') desc, m.joined_at, p.id
      limit 5
    ),
    case
      when inv.revoked_at is not null then 'revoked'
      when inv.expires_at is not null and inv.expires_at <= now() then 'expired'
      when inv.max_uses is not null and inv.uses >= inv.max_uses then 'used_up'
      else 'valid'
    end,
    exists (
      select 1 from public.group_members m
      where m.group_id = g.id and m.user_id = auth.uid()
    )
  from public.groups g
  where g.id = inv.group_id;
end;
$$;

-- Joins the group behind an invite code. Already being a member is not an
-- error and does not use up the invite.
create or replace function public.accept_invite(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  inv public.group_invites;
  my_email text;
begin
  select * into inv
  from public.group_invites i
  where i.code = accept_invite.code
  for update;

  if inv.id is null then
    raise exception using message = 'This invite link is not valid', hint = 'invite_not_found', errcode = 'P0002';
  end if;

  if exists (select 1 from public.group_members m where m.group_id = inv.group_id and m.user_id = uid) then
    return inv.group_id;
  end if;

  if inv.revoked_at is not null then
    raise exception using message = 'This invite has been revoked', hint = 'invite_revoked', errcode = '23514';
  end if;
  if inv.expires_at is not null and inv.expires_at <= now() then
    raise exception using message = 'This invite has expired', hint = 'invite_expired', errcode = '23514';
  end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then
    raise exception using message = 'This invite has been used up', hint = 'invite_used_up', errcode = '23514';
  end if;
  if inv.email is not null then
    select lower(u.email) into my_email from auth.users u where u.id = uid;
    if my_email is distinct from inv.email then
      raise exception using message = 'This invite was sent to a different email address', hint = 'invite_wrong_email', errcode = '42501';
    end if;
  end if;
  if exists (select 1 from public.groups g where g.id = inv.group_id and g.archived_at is not null) then
    raise exception using message = 'This group is archived', hint = 'group_archived', errcode = '23514';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (inv.group_id, uid, inv.role);

  update public.group_invites i set uses = i.uses + 1 where i.id = inv.id;

  return inv.group_id;
end;
$$;

revoke execute on function
  public.create_invite(uuid, public.group_role, int, timestamptz, text),
  public.invite_preview(text),
  public.accept_invite(text)
from public, anon;

grant execute on function public.invite_preview(text) to anon;

grant execute on function
  public.create_invite(uuid, public.group_role, int, timestamptz, text),
  public.invite_preview(text),
  public.accept_invite(text)
to authenticated, service_role;
