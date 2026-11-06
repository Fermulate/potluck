# Database tests

pgTAP tests (`*.test.sql`), run in file name order against the local stack with `pnpm db:test`, or one file with `npx supabase test db supabase/tests/000_setup.test.sql supabase/tests/<file>.test.sql`.

- Helpers (`tests.create_user`, `tests.login`, `tests.group_with`, ...) and an example: [docs/development.md](../../docs/development.md#writing-pgtap-tests).
- What each file covers: [docs/testing.md](../../docs/testing.md#database-tests).
- `01_schema.test.sql` pins the schema shape; its header lists which changes must update it.
