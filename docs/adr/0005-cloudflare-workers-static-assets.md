# 5. Cloudflare Workers static assets for hosting

- Status: accepted
- Date: 2026-11-05

## Context

The web app is a static SPA: an `index.html`, hashed JS and CSS, and a service worker. It needs HTTPS, a CDN, a fallback that serves `index.html` for client-side routes like `/groups/abc`, per-PR previews, and a price of zero. The first plan was Cloudflare Pages. Cloudflare now steers new projects to Workers with static assets, which gives the same CDN and adds preview aliases on versions.

## Decision

Deploy `apps/web/dist` as a Worker with only static assets, configured in `apps/web/wrangler.jsonc`:

- `assets.not_found_handling = "single-page-application"` serves `index.html` for unknown paths, so deep links work without a `_redirects` file.
- No Worker script. Nothing runs on the edge except asset serving.
- `main` deploys with `wrangler deploy` to https://potluck.potluck-web.workers.dev.
- Pull requests run `wrangler versions upload --preview-alias pr-<number>`, which gives a stable preview URL per PR without touching production.
- Supabase Auth allows redirects to `https://*-potluck.potluck-web.workers.dev/**` so sign-in works on previews.

## Consequences

- Hosting costs nothing at current traffic, and static asset requests do not count against Worker invocations.
- Previews talk to the production Supabase project, because the build uses the same `VITE_*` variables. A preview can read and write real data for whoever signs in. Fine while the team is small, worth revisiting before outside contributors get deploy previews.
- If the app ever needs server-side code (Open Graph tags for invite links, for example), it can be added as a Worker script in the same project.
- The deploy needs a Cloudflare API token and account id in GitHub. Without them the workflow still builds and skips the upload.
