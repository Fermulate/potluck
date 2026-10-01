-- RLS: groups, members, invites. Creating groups, joining and every membership
-- change go through RPCs, so there are no insert policies here.

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;

create policy "groups: members read"
on public.groups for select
to authenticated
using (id in (select private.my_group_ids()));

create policy "groups: admins edit settings"
on public.groups for update
to authenticated
using ((select private.is_group_admin(id)))
with check ((select private.is_group_admin(id)));

create policy "groups: owner deletes"
on public.groups for delete
to authenticated
using ((select private.group_role(id)) = 'owner');

create policy "group_members: members read"
on public.group_members for select
to authenticated
using (group_id in (select private.my_group_ids()));

-- Admins see every invite of their group, members see the ones they made.
create policy "group_invites: admins and creator read"
on public.group_invites for select
to authenticated
using (
  (select private.is_group_admin(group_id))
  or (created_by = (select auth.uid()) and group_id in (select private.my_group_ids()))
);

create policy "group_invites: admins and creator revoke"
on public.group_invites for update
to authenticated
using (
  (select private.is_group_admin(group_id))
  or (created_by = (select auth.uid()) and group_id in (select private.my_group_ids()))
)
with check (
  (select private.is_group_admin(group_id))
  or (created_by = (select auth.uid()) and group_id in (select private.my_group_ids()))
);

create policy "group_invites: admins and creator delete"
on public.group_invites for delete
to authenticated
using (
  (select private.is_group_admin(group_id))
  or (created_by = (select auth.uid()) and group_id in (select private.my_group_ids()))
);
