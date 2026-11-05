# Launch checklist

What is live, what still needs a person with the right account, and how to finish each item.

## Live now

| Piece          | Where                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Web app (PWA)  | https://potluck.potluck-web.workers.dev (Cloudflare Workers static assets, `apps/web/wrangler.jsonc`)             |
| User guide     | https://potluck-docs.potluck-web.workers.dev (repo `Fermulate/potluck-docs`)                                      |
| Database       | Supabase project `mzotlkpghnrwbezcazld`, every migration in `supabase/migrations` applied                         |
| Auth settings  | Site URL and redirect URLs pushed with `supabase config push` (`[remotes.production]` in `supabase/config.toml`)  |
| Edge functions | `notify`, `fx-sync`, `ics-feed`, `delete-account`, with their secrets set                                         |
| Vault entries  | `project_url` and `edge_secret`, so push notifications and the daily FX job fire                                  |
| FX rates       | Backfilled from 2026-08-01, refreshed daily by pg_cron at 16:30 UTC                                               |
| GitHub         | Branch protection on `main`, CODEOWNERS review, secret scanning with push protection, Dependabot security updates |

## Needs a person

### 1. Cloudflare API token (CI deploys)

The deploy workflow builds on every push but only deploys when `CLOUDFLARE_API_TOKEN` exists.

1. Cloudflare dashboard, My Profile, API Tokens, Create Token, template "Edit Cloudflare Workers".
2. Scope it to the account that owns `potluck-web.workers.dev`.
3. Add it as a repository secret named `CLOUDFLARE_API_TOKEN` in both `Fermulate/potluck` and `Fermulate/potluck-docs`.

`CLOUDFLARE_ACCOUNT_ID` is already set as a repository variable.

### 2. Supabase credentials (CI migrations)

The `migrate` job skips until both secrets exist.

- `SUPABASE_ACCESS_TOKEN`: Supabase dashboard, Account, Access Tokens.
- `SUPABASE_DB_PASSWORD`: the project's database password (Project Settings, Database; reset it there if nobody has it).

### 3. Email

Auth email uses Supabase's built-in sender, which is rate limited and meant for testing. Email confirmation is on in production, so sign-ups beyond the limit wait. When there is a domain:

1. Create a Resend (or other SMTP) account and verify the domain.
2. Supabase dashboard, Authentication, SMTP settings: enter the SMTP details.
3. Optionally raise `[auth.rate_limit] email_sent` for production.

### 4. Sign in with Google or Apple

Both buttons are hidden behind `app_config` flags (`google_auth`, `apple_auth`). To turn one on:

1. Create the OAuth client in Google Cloud or Apple Developer with the redirect `https://mzotlkpghnrwbezcazld.supabase.co/auth/v1/callback`.
2. Add the client id and secret under Authentication, Providers.
3. `update public.app_config set value = 'true' where key = 'google_auth';`

### 5. Calendar import

`calendar_import` is off. It needs Google and Microsoft OAuth apps with calendar read scopes and a sync function that fills `busy_blocks`. The schema and the UI legend are ready.

### 6. Custom domain (optional)

If a domain is bought:

1. Add it to the `potluck` and `potluck-docs` Workers as custom domains in Cloudflare.
2. Update `VITE_APP_URL` and `VITE_DOCS_URL` repository variables, the `site` in the guide's `astro.config.mjs`, `[remotes.production.auth]` URLs in `supabase/config.toml`, then run `supabase config push`.
3. Update the `APP_URL` edge function secret.

### 7. PR preview data

PR previews build against the production Supabase project. Before inviting outside contributors, create a separate Supabase project for previews and point a `preview` GitHub environment's variables at it.

## Known gaps worth a ticket

- Repeating expenses can only change description, category and schedule; amount and split changes need a migration that lets clients update them.
- Itemized line items are not stored, so editing a by-item expense reopens it as exact amounts.
- A deleted payment cannot be restored (there is no restore RPC).
- Notification preferences are a single push switch; per-type settings need a table.
- Activity is one feed across all groups; there is no per-group filter yet.
