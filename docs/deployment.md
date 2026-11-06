# Deployment

Potluck runs on two free tiers: Cloudflare serves the static web app, and one Supabase project is the whole backend. GitHub Actions deploys both. The pipeline is drawn step by step in [sequences.md](sequences.md#deploy-pipeline).

## Environments

| Environment | Web                                                                          | Backend                                 | Deployed by                        |
| ----------- | ---------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------- |
| Local       | http://localhost:5173 (`pnpm dev`)                                           | local Supabase in Docker                | you                                |
| Preview     | `https://pr-<number>-potluck.potluck-web.workers.dev` (worker version alias) | **production** Supabase project         | `deploy.yml` on every pull request |
| Production  | https://potluck.potluck-web.workers.dev                                      | Supabase project `mzotlkpghnrwbezcazld` | `deploy.yml` on push to `main`     |

Previews are web-only. They build with the same `VITE_*` variables as production, so a preview signs in against production data and runs whatever migrations production already has. A PR that needs a new migration cannot be fully tested on its preview: test it locally.

The workflow uses two GitHub environments, `preview` and `production`. GitHub creates them on the first run. The `migrate` job and the production web deploy use `production`, so adding required reviewers there gates every release.

## GitHub configuration

Set these under **Settings > Secrets and variables > Actions**. Variables are visible in logs, secrets are not.

### Variables

| Name                            | Example                                        | Used for                                                                            |
| ------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | `https://mzotlkpghnrwbezcazld.supabase.co`     | baked into the web build                                                            |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...`                           | baked into the web build. Public by design, RLS guards data                         |
| `VITE_APP_URL`                  | `https://potluck.potluck-web.workers.dev`      | baked into the build, and the smoke test URL                                        |
| `VITE_VAPID_PUBLIC_KEY`         | base64url public key                           | web push subscription in the browser                                                |
| `VITE_DOCS_URL`                 | `https://potluck-docs.potluck-web.workers.dev` | user guide that in-app help links open. Optional: the app falls back to the example |
| `CLOUDFLARE_ACCOUNT_ID`         | 32 hex chars                                   | `wrangler deploy` and `versions upload`                                             |
| `SUPABASE_PROJECT_REF`          | `mzotlkpghnrwbezcazld`                         | `supabase link`. The workflow falls back to this ref if unset                       |

### Secrets

| Name                                   | Used for                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`                 | Wrangler. Needs the "Edit Cloudflare Workers" template permissions on the account        |
| `SUPABASE_ACCESS_TOKEN`                | Supabase CLI (personal access token from the dashboard)                                  |
| `SUPABASE_DB_PASSWORD`                 | `supabase db push` to the remote database                                                |
| `SUPABASE_URL`                         | `keepalive.yml` daily ping                                                               |
| `SUPABASE_PUBLISHABLE_KEY`             | `keepalive.yml` daily ping                                                               |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` | `supabase config push`, once Google sign in is enabled (`production` environment secret) |
| `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET`  | `supabase config push`, once Apple sign in is enabled (`production` environment secret)  |

Missing credentials do not fail the workflow. Without `CLOUDFLARE_API_TOKEN` the web job builds and skips the upload. Without both Supabase secrets the `migrate` job logs a notice and skips. That keeps forks green.

## What a production deploy does

On push to `main`:

1. **migrate** (environment `production`):
   ```sh
   supabase link --project-ref $SUPABASE_PROJECT_REF
   supabase db push --remote --yes      # new migrations only
   supabase config push --yes           # auth, storage and pooler settings
   supabase functions deploy            # every function in supabase/functions
   ```
2. **web**, only if `migrate` succeeded or was skipped: `pnpm turbo run build --filter=@potluck/web`, then `wrangler deploy` from `apps/web`.
3. **smoke test**: `GET $VITE_APP_URL/groups` up to six times, 10 seconds apart. Anything other than a 200 fails the run. `/groups` is a client route, so a 200 proves the SPA fallback works too.

Migrations go first so the database is never behind the client. Because migrations are additive ([ADR 8](adr/0008-additive-migrations-and-versioned-rpcs.md)), the old client keeps working in the minutes before the new one is live.

### Supabase config push

`supabase/config.toml` holds local settings at the top and production overrides under `[remotes.production]`. `supabase config push` applies the overrides when the linked project's ref matches `remotes.production.project_id`. Production differs from local in:

- `auth.site_url` and `additional_redirect_urls`: the workers.dev URL, every `*-potluck.potluck-web.workers.dev` preview, and localhost.
- `minimum_password_length = 8`, email confirmations on, one email per 60 s per address.
- TOTP MFA enroll and verify on.
- Pooler sizes, and the vector bucket feature off.

`verify_jwt` per function (`[functions.*]`) is applied by `supabase functions deploy`.

## Edge function secrets

Set once per project, outside CI:

```sh
npx supabase secrets set --project-ref <ref> \
  VAPID_PUBLIC_KEY=... \
  VAPID_PRIVATE_KEY=... \
  VAPID_SUBJECT=mailto:you@example.com \
  EDGE_SECRET=$(openssl rand -base64 48 | tr -d '\n') \
  APP_URL=https://potluck.potluck-web.workers.dev
```

| Secret              | Read by              | Notes                                                                                |
| ------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `VAPID_PUBLIC_KEY`  | `notify`             | same value as the `VITE_VAPID_PUBLIC_KEY` variable                                   |
| `VAPID_PRIVATE_KEY` | `notify`             | without the key pair `notify` answers `{ skipped: 'vapid_not_configured' }`          |
| `VAPID_SUBJECT`     | `notify`             | a `mailto:` or https URL for push services to contact. Defaults to `APP_URL`         |
| `EDGE_SECRET`       | `notify`, `fx-sync`  | shared with the database. Must equal the Vault `edge_secret`                         |
| `APP_URL`           | `notify`, `ics-feed` | base for links in push messages and calendar events. Defaults to the workers.dev URL |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided by the platform. Generate VAPID keys with `npx web-push generate-vapid-keys`.

## Vault entries

The database calls edge functions through `private.invoke_edge_function`, which reads two Vault secrets. Create them once per project in the SQL editor:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<same value as EDGE_SECRET>', 'edge_secret');
```

Until both exist, the push hook and the daily FX job do nothing, silently. If push or FX rates stop working, check these first. To rotate the shared secret, update both sides together:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'edge_secret'),
  '<new value>'
);
```

```sh
npx supabase secrets set --project-ref <ref> EDGE_SECRET=<new value>
```

After setting up a new project, backfill FX rates once so multi-currency expenses work right away:

```sh
curl -X POST "https://<ref>.supabase.co/functions/v1/fx-sync?from=2026-01-01" \
  -H "x-potluck-secret: <EDGE_SECRET>"
```

## Rollback

| What           | How                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web            | `cd apps/web && npx wrangler rollback` returns to the previous version. `npx wrangler versions list` shows older ones, and `npx wrangler versions deploy <version-id>@100%` picks one |
| Edge functions | check out the last good commit and run `npx supabase functions deploy <name> --project-ref <ref>`                                                                                     |
| Database       | roll forward. Write a new migration that undoes the change and merge it. There are no down migrations, and `db push` never rewinds                                                    |
| Auth config    | revert the `config.toml` change and let the next deploy push it, or run `supabase config push` from the reverted commit                                                               |

Rolling back the web app alone is always safe, because the schema only ever gains things. Reverting a merge commit on `main` redeploys the web app but leaves the database as it is.

Recovering lost data depends on the backups your Supabase plan includes. Check what you have in the dashboard before you need it, and take a `npx supabase db dump --data-only` before risky migrations.

## Self-hosting

You can run your own Potluck on your own Supabase project and Cloudflare account. The AGPL requires you to offer your users the source of your version, changes included.

1. **Fork** the repository.
2. **Create a Supabase project.** Note its ref, database password and URL. Create a personal access token.
3. **Edit `supabase/config.toml`.** Set `[remotes.production] project_id` to your ref, and replace `potluck.potluck-web.workers.dev` in the auth URLs with your domain. If the ref does not match, `config push` applies the local settings (localhost redirects, no email confirmation, 6 character passwords) to your project.
4. **Edit `apps/web/wrangler.jsonc`** if you want a different worker name. The URL is `https://<name>.<your-subdomain>.workers.dev`.
5. **Add the GitHub variables and secrets** listed above, with your values. `SUPABASE_PROJECT_REF` is required, otherwise the workflow links the upstream project and fails.
6. **Set edge function secrets and Vault entries** as above, with your URLs.
7. **Push to `main`.** The workflow applies migrations, pushes auth config, deploys functions and the web app, and smoke tests it.
8. **Backfill FX rates** with the `fx-sync?from=` call.
9. **Auth email.** The built-in Supabase SMTP is rate limited and meant for testing. For real users, configure your own SMTP server under `[auth.email.smtp]` or in the dashboard.

`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` secrets keep a free project from pausing; skip them on a paid plan.

To deploy by hand instead of through Actions:

```sh
npx supabase link --project-ref <ref>
npx supabase db push
npx supabase config push
npx supabase functions deploy
VITE_SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... VITE_APP_URL=... \
  pnpm turbo run build --filter=@potluck/web
cd apps/web && npx wrangler deploy
```
