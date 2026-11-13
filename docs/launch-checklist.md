# Launch checklist

What is live, what still needs a person with the right account, and how to finish each item.

## Live now

| Piece          | Where                                                                                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web app (PWA)  | https://potluck.fermulate.com (Cloudflare Workers static assets, `apps/web/wrangler.jsonc`)                                                                                                                                                                      |
| User guide     | https://docs.potluck.fermulate.com (repo `Fermulate/potluck-docs`)                                                                                                                                                                                               |
| Custom domains | `potluck.fermulate.com` and `docs.potluck.fermulate.com` attached to the `potluck` and `potluck-docs` Workers, pinned as `custom_domain` routes in each `wrangler.jsonc`. The `*.potluck-web.workers.dev` URLs still work ([ADR 10](adr/0010-custom-domains.md)) |
| Database       | Supabase project `mzotlkpghnrwbezcazld`, every migration in `supabase/migrations` applied                                                                                                                                                                        |
| Auth settings  | Site URL and redirect URLs pushed with `supabase config push` (`[remotes.production]` in `supabase/config.toml`)                                                                                                                                                 |
| Edge functions | `notify`, `fx-sync`, `ics-feed`, `delete-account`, with their secrets set                                                                                                                                                                                        |
| Vault entries  | `project_url` and `edge_secret`, so push notifications and the daily FX job fire                                                                                                                                                                                 |
| FX rates       | Backfilled from 2026-08-01, refreshed daily by pg_cron at 16:30 UTC                                                                                                                                                                                              |
| GitHub         | Branch protection on `main`, CODEOWNERS review, secret scanning with push protection, Dependabot security updates                                                                                                                                                |
| Keepalive      | `keepalive.yml` pings the REST API daily (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` secrets) so the free project does not pause                                                                                                                                 |

## Needs a person

### 1. Cloudflare API token (CI deploys)

The deploy workflow builds on every push but only deploys when `CLOUDFLARE_API_TOKEN` exists.

1. Cloudflare dashboard, My Profile, API Tokens, Create Token, template "Edit Cloudflare Workers".
2. Scope it to the account that owns `potluck-web.workers.dev`, with the `fermulate.com` zone included under Zone Resources: deploys manage the custom domain routes, which needs Workers Routes edit on that zone.
3. Add it as a repository secret named `CLOUDFLARE_API_TOKEN` in both `Fermulate/potluck` and `Fermulate/potluck-docs`.

`CLOUDFLARE_ACCOUNT_ID` is already set as a repository variable.

### 2. Supabase credentials (CI migrations)

The `migrate` job skips until `SUPABASE_ACCESS_TOKEN` exists (Supabase dashboard, Account, Access Tokens). With it, every merge to `main` that passes CI pushes migrations, auth config and edge functions. The database password is not needed: the pinned CLI signs in with a temporary role made from the token.

### 3. Email

Auth email uses Supabase's built-in sender, which is rate limited and meant for testing. Email confirmation is on in production, so sign-ups beyond the limit wait. Notification email (new expenses, payments, the monthly summary, with one-click unsubscribe) is built but off: `app_config.email_notifications` is `false`, so nothing is queued. To send from `fermulate.com`:

1. Create a Resend account and verify the domain.
2. Supabase dashboard, Authentication, SMTP settings: enter Resend's SMTP details (auth email).
3. In `supabase/config.toml`, delete the four `[remotes.production.auth.email.notification.*]` blocks so production sends the Potluck security notice subjects. The built-in sender refuses custom subjects, so do this only after step 2.
4. Optionally raise `[auth.rate_limit] email_sent` for production.
5. Notification email: set the function secrets `RESEND_API_KEY` and `EMAIL_FROM` (for example `Potluck <notifications@fermulate.com>`, optionally `EMAIL_REPLY_TO`), and deploy the `unsubscribe` function with the others.
6. Flip it on: `update public.app_config set value = 'true' where key = 'email_notifications';`. The Me page then shows the Email column, and the `email-notifications` job starts sending within a minute. Setting it back to `false` stops new email right away.

Nothing else changes: the sender, the outbox, the monthly summary job and the unsubscribe links are already deployed ([ADR 11](adr/0011-notification-prefs-and-email.md)).

### 4. Sign in with Google or Apple

Both buttons are hidden behind `app_config` flags (`google_auth`, `apple_auth`). Provider settings live in `supabase/config.toml`: every deploy runs `supabase config push`, which overwrites whatever was entered in the dashboard, so configure them in the file. To turn one on:

1. Create the OAuth client in Google Cloud or Apple Developer with the redirect `https://mzotlkpghnrwbezcazld.supabase.co/auth/v1/callback`.
2. Add the client secret to the GitHub `production` environment as `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` (or `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET`). The `migrate` job passes both to `supabase config push`.
3. Under the `[remotes.production]` overrides in `supabase/config.toml`, add the provider (same shape with `apple` for Apple), then merge to `main`:

   ```toml
   [remotes.production.auth.external.google]
   enabled = true
   client_id = "<client id>"
   secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
   ```

4. `update public.app_config set value = 'true' where key = 'google_auth';` (or `apple_auth`).

### 5. Calendar import

`calendar_import` is off. It needs Google and Microsoft OAuth apps with calendar read scopes and a sync function that fills `busy_blocks`. The schema and the UI legend are ready.

### 6. PR preview data

PR previews build against the production Supabase project. Before inviting outside contributors, create a separate Supabase project for previews and point a `preview` GitHub environment's variables at it.

## Known gaps worth a ticket

- Repeating expenses can only change description, category and schedule; amount and split changes need a migration that lets clients update them.
- Itemized line items are not stored, so editing a by-item expense reopens it as exact amounts.
- A deleted payment cannot be restored (there is no restore RPC).
- Activity is one feed across all groups; there is no per-group filter yet.
