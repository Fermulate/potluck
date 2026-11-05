-- Scheduled jobs (pg_cron). Same SQL works on the local stack and hosted
-- Supabase, per the Supabase Cron install guide.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- Turns due recurring templates into real expenses. Catches up on missed
-- periods (at most 12 per template per run). A template whose payer or split
-- members left the group, or whose group was archived, is deactivated. A
-- missing FX rate leaves the template due so the next run retries it.
-- Returns the number of expenses created.
create or replace function private.materialize_recurring_expenses(run_on date default current_date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recurring_expenses;
  g public.groups;
  fx numeric;
  new_id uuid;
  due date;
  runs int;
  made int := 0;
begin
  for r in
    select * from public.recurring_expenses x
    where x.active and x.next_run_on <= run_on
    order by x.next_run_on, x.id
    for update skip locked
  loop
    begin
      select * into g from public.groups x where x.id = r.group_id;

      if g.archived_at is not null
         or not exists (select 1 from public.group_members m where m.group_id = r.group_id and m.user_id = r.paid_by)
         or exists (
           select 1 from jsonb_array_elements(r.splits) e
           where not exists (
             select 1 from public.group_members m
             where m.group_id = r.group_id and m.user_id = (e ->> 'user_id')::uuid
           )
         ) then
        update public.recurring_expenses x set active = false where x.id = r.id;
        continue;
      end if;

      due := r.next_run_on;
      runs := 0;
      while due <= run_on and runs < 12 loop
        fx := private.fx_rate(r.currency, g.currency, due);
        exit when fx is null;

        insert into public.expenses (
          group_id, description, amount_cents, currency, fx_rate, paid_by, split_type,
          category, spent_at, recurring_id, created_by
        ) values (
          r.group_id, r.description, r.amount_cents, r.currency, fx, r.paid_by, r.split_type,
          r.category, due, r.id, r.created_by
        )
        returning id into new_id;

        insert into public.expense_splits (expense_id, user_id, share_cents, weight)
        select new_id, c.user_id, c.share_cents, c.weight
        from private.compute_splits(r.amount_cents, r.split_type, r.splits) c;

        due := (due + case r.recurrence
          when 'weekly' then interval '1 week'
          when 'monthly' then interval '1 month'
          else interval '1 year' end)::date;
        runs := runs + 1;
        made := made + 1;
      end loop;

      update public.recurring_expenses x set next_run_on = due where x.id = r.id;
    exception
      when others then
        raise warning 'recurring expense % skipped: %', r.id, sqlerrm;
    end;
  end loop;

  return made;
end;
$$;

-- Once per scheduled event, within 24h of the start: people going or maybe get
-- event.reminder, members who have not answered get rsvp.reminder.
create or replace function private.send_event_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
  sent int := 0;
  payload jsonb;
  going uuid[];
  unanswered uuid[];
begin
  for ev in
    select * from public.events e
    where e.status = 'scheduled'
      and e.reminder_sent_at is null
      and e.starts_at > now()
      and e.starts_at <= now() + interval '24 hours'
    order by e.starts_at
    for update skip locked
  loop
    payload := jsonb_build_object(
      'event_id', ev.id,
      'group_id', ev.group_id,
      'event_title', ev.title,
      'starts_at', ev.starts_at
    );

    select array_agg(r.user_id) into going
    from public.event_rsvps r
    where r.event_id = ev.id and r.status in ('going', 'maybe');

    select array_agg(m.user_id) into unanswered
    from public.group_members m
    where m.group_id = ev.group_id
      and not exists (select 1 from public.event_rsvps r where r.event_id = ev.id and r.user_id = m.user_id);

    perform private.notify(coalesce(going, '{}'), 'event.reminder', payload);
    perform private.notify(coalesce(unanswered, '{}'), 'rsvp.reminder', payload);

    update public.events e set reminder_sent_at = now() where e.id = ev.id;
    sent := sent + 1;
  end loop;

  return sent;
end;
$$;

-- Scheduled events that have ended become done.
create or replace function private.finish_past_events()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  update public.events e set status = 'done'
  where e.status = 'scheduled'
    and coalesce(e.ends_at, e.starts_at) < now();
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function
  private.materialize_recurring_expenses(date),
  private.send_event_reminders(),
  private.finish_past_events()
from public, anon, authenticated;

-- cron.schedule with an existing job name updates that job, so this is safe to rerun.
select cron.schedule('materialize-recurring-expenses', '10 0 * * *',
  $$select private.materialize_recurring_expenses()$$);
select cron.schedule('event-reminders', '5 * * * *',
  $$select private.send_event_reminders(); select private.finish_past_events()$$);
