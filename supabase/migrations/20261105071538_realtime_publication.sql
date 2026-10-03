-- Realtime postgres_changes for the live parts of the app. Realtime applies
-- each subscriber's RLS select policies before delivering a change.

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array[
    'availability', 'expenses', 'expense_splits', 'settlements', 'activity',
    'notifications', 'event_rsvps', 'events', 'group_members'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
