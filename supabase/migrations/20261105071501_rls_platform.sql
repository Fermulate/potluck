-- RLS: activity, comments, notifications, push tokens, app config.

alter table public.activity enable row level security;
alter table public.comments enable row level security;
alter table public.notifications enable row level security;
alter table public.push_tokens enable row level security;
alter table public.app_config enable row level security;

create policy "activity: members read"
on public.activity for select
to authenticated
using (group_id in (select private.my_group_ids()));

create policy "comments: members read"
on public.comments for select
to authenticated
using (group_id in (select private.my_group_ids()));

-- group_id is filled from the parent by a before-insert trigger, so this check
-- sees the real group.
create policy "comments: members write own"
on public.comments for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and group_id in (select private.my_group_ids())
);

-- Authors edit or soft delete their comments; admins can soft delete any.
-- Row policies cannot limit columns per role, so this trigger keeps body
-- changes to the author.
create or replace function private.comments_guard_body()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body is distinct from old.body
     and (select auth.uid()) is not null
     and (select auth.uid()) is distinct from old.author_id then
    raise exception using message = 'not_allowed', detail = 'Only the author can edit a comment', errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger comments_guard_body
before update on public.comments
for each row execute function private.comments_guard_body();

create policy "comments: author or admin update"
on public.comments for update
to authenticated
using (
  group_id in (select private.my_group_ids())
  and (author_id = (select auth.uid()) or (select private.is_group_admin(group_id)))
)
with check (
  group_id in (select private.my_group_ids())
  and (author_id = (select auth.uid()) or (select private.is_group_admin(group_id)))
);

create policy "notifications: read own"
on public.notifications for select
to authenticated
using (user_id = (select auth.uid()));

create policy "notifications: mark own read"
on public.notifications for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "notifications: delete own"
on public.notifications for delete
to authenticated
using (user_id = (select auth.uid()));

create policy "push_tokens: read own"
on public.push_tokens for select
to authenticated
using (user_id = (select auth.uid()));

create policy "push_tokens: create own"
on public.push_tokens for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "push_tokens: update own"
on public.push_tokens for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "push_tokens: delete own"
on public.push_tokens for delete
to authenticated
using (user_id = (select auth.uid()));

create policy "app_config: everyone reads"
on public.app_config for select
to anon, authenticated
using (true);
