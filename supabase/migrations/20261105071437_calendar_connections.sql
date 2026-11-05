-- External calendar links (Google, Microsoft). OAuth tokens never live in this
-- table: they are stored in Vault and referenced by secret id. Rows are written
-- by an edge function with the service role. Feature flagged off (calendar_import).

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  account_email text,
  access_token_secret_id uuid,
  refresh_token_secret_id uuid,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

comment on column public.calendar_connections.access_token_secret_id is 'vault.secrets id; never readable by clients.';

revoke all on table public.calendar_connections from anon, authenticated;
-- Clients may see that a connection exists, not the secret references.
grant select (id, user_id, provider, account_email, last_synced_at, created_at)
  on table public.calendar_connections to authenticated;
grant delete on table public.calendar_connections to authenticated;
grant all on table public.calendar_connections to service_role;
