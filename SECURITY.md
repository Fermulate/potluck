# Security Policy

Potluck handles money and personal data for groups of friends, so we take security reports seriously.

## Reporting a vulnerability

Please **do not** open a public issue, pull request or discussion for security problems.

Report vulnerabilities privately through GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/Fermulate/potluck/security) of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue, how to reproduce it, and its impact. Include any proof of concept if you have one.

We aim to acknowledge reports within 3 business days and to keep you updated until the issue is resolved. Once a fix ships, we are happy to credit you in the advisory unless you prefer to stay anonymous.

## Scope

In scope: this repository's code, including the web app, shared packages, database migrations and row level security policies, and CI configuration.

Out of scope: vulnerabilities in third-party services (Supabase, Cloudflare, GitHub) themselves; report those to the vendor. Denial of service through volume, social engineering, and findings from automated scanners without a demonstrated impact are also out of scope.

## Supported versions

Only the latest version deployed from `main` receives security fixes.

## How Potluck is secured

The threat model, what data we store and who can see it, how account deletion works, and how we handle secrets are in [docs/security.md](docs/security.md). The authorization design (row level security, security definer functions, storage policies, edge function auth) is in [docs/architecture.md](docs/architecture.md#security-model).
