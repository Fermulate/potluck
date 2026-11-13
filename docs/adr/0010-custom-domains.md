# 10. Custom domains on fermulate.com

- Status: accepted
- Date: 2026-11-12

## Context

The app and the user guide launched on `workers.dev` URLs ([ADR 5](0005-cloudflare-workers-static-assets.md)). Those are long, tie the product to a Cloudflare account subdomain, and cannot carry email or a brand. The org now owns `fermulate.com`, and both Workers have Cloudflare custom domains attached. People already have the old URLs bookmarked and installed as PWAs, and PR previews only exist on `workers.dev`.

## Decision

- The app is https://potluck.fermulate.com and the guide is https://docs.potluck.fermulate.com. These are the canonical URLs: `VITE_APP_URL`, `VITE_DOCS_URL`, the `APP_URL` edge function secret, Supabase `site_url`, and the guide's Astro `site` all use them.
- Each repo's `wrangler.jsonc` lists its hostname as a route with `custom_domain: true`, so a deploy never detaches the domain that was set up in the dashboard.
- Both `wrangler.jsonc` files set `workers_dev: true`, because wrangler turns `workers.dev` off by default once `routes` exist. The old URLs keep serving the same Worker as secondary origins.
- The app's Worker also sets `preview_urls: true`, so PR previews stay at `pr-<number>-potluck.potluck-web.workers.dev`.
- Supabase Auth keeps the old app URL and the preview wildcard in `additional_redirect_urls` next to the new domain.

## Consequences

- Links the server builds (push messages, calendar events, invite links, share tags) point at the new domain once `APP_URL` and `VITE_APP_URL` are updated and the app redeployed.
- A PWA installed from the old URL is a separate origin with its own storage and session, so those people sign in once more if they switch. Nothing forces them to.
- The Cloudflare API token used by CI needs Workers Routes permission on the `fermulate.com` zone, or the deploy fails while syncing the custom domain.
- Self-hosters must change or remove the `routes` entry, since they do not own the zone.
