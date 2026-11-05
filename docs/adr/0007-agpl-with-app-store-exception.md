# 7. AGPL-3.0 with an App Store exception

- Status: accepted
- Date: 2026-11-05

## Context

Potluck holds people's money history and their friends list. We want anyone who runs a modified copy as a service to share their changes, so users of a fork can see what it does with their data. That points at the GNU AGPL. The AGPL also clashes with the terms of the Apple App Store and Google Play, which add usage restrictions the license forbids, and we plan a native app.

## Decision

License the whole repository under the GNU AGPL version 3, with an additional permission under section 7 (at the end of [LICENSE](../../LICENSE)): the work may be distributed through mobile app stores whose terms conflict with the AGPL, as long as the Corresponding Source stays available under the AGPL. Contributors agree to the same terms when they submit code (see [CONTRIBUTING.md](../../CONTRIBUTING.md)).

## Consequences

- A hosted fork has to offer its source to its users, including changes to RLS policies and RPCs.
- We, and anyone else, can publish builds to the App Store and Google Play.
- Downstream projects may drop the exception from their copy, as section 7 allows. Code taken from such a fork cannot come back into an app store build without the authors' permission.
- Some companies avoid AGPL code entirely, which may cost us contributors. We accept that.
- Changing the license later would need agreement from every copyright holder, so the choice is close to permanent.
