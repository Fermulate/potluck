-- Google sign in is configured for production (supabase/config.toml, [remotes.production.auth.external.google]),
-- so show its button. supabase/seed.sql turns it back off for local stacks, which have no Google provider.
update public.app_config set value = 'true'::jsonb where key = 'google_auth';
