# @datasheets/db

Drizzle ORM schema, migrations, and seed data for DataSheets, backed by Postgres 16.

## Tenant isolation model

- Every tenant-scoped table has a **composite primary key** `(company_id, id)`, and every
  foreign key between tenant tables is composite (`(company_id, parent_id)`), so a row can
  never be joined across companies even by application bugs — the database schema itself
  makes cross-tenant references impossible.
- **Row-Level Security** (RLS) is enabled and `FORCE`d on every tenant table. Policies
  restrict all `SELECT/INSERT/UPDATE/DELETE` to rows where `company_id = current_company_id()`,
  a `STABLE` SQL function that reads the session GUC `app.company_id`.
- `users` and `sessions` are a **global identity store** (no `company_id`). They also have
  ENABLE + FORCE RLS; `datasheets_app` gets open `USING (true)` policies so login can
  look up by email and resolve sessions by token. Session tokens should be stored hashed.
  FORCE RLS means only `BYPASSRLS` roles skip policies — table ownership alone is not enough.
- Roles (see `drizzle/0000_foundation.sql` + `0002_runtime_api_role.sql`):
  - `datasheets_owner` — owns tables, `BYPASSRLS` (`0001_owner_bypass.sql`). Migrations/seed only.
  - `datasheets_app` — `NOLOGIN` / `NOBYPASSRLS`, DML grants, RLS-enforced. Assumed via `SET ROLE`.
  - `datasheets_runtime` — **API login role**. `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOINHERIT`.
    Granted `datasheets_app` **WITH INHERIT FALSE** (must `SET LOCAL ROLE datasheets_app`).
    **Never** granted `datasheets_owner` — `SET ROLE datasheets_owner` must fail.
  - `datasheets_migrate` — optional non-login role granted `datasheets_owner` for tooling.
- The API sets `SET LOCAL ROLE datasheets_app` and
  `SELECT set_config('app.company_id', ..., true)` inside every tenant transaction
  (see `withTenant` / `asTenant`), scoped to that transaction only.
- `company_id` is **never** accepted from client input for scoping reads/writes — it is
  always derived from the authenticated session and set via `SET LOCAL` before any query.

## Production role separation

| Purpose | Connection |
| --- | --- |
| Migrate / seed | Superuser or owner-capable URL (local docker: `datasheets` / `datasheets`) |
| API / workers | `datasheets_runtime` only |

```bash
# Migrate / seed (superuser)
DATABASE_URL=postgresql://datasheets:datasheets@localhost:5432/datasheets pnpm db:migrate
DATABASE_URL=postgresql://datasheets:datasheets@localhost:5432/datasheets pnpm db:seed

# API (.env)
DATABASE_URL=postgresql://datasheets_runtime:datasheets_runtime@localhost:5432/datasheets
```

**Production checklist**

1. Override the dev password immediately:
   `ALTER ROLE datasheets_runtime PASSWORD '<strong-secret>';`
2. Confirm `datasheets_runtime` is **not** a member of `datasheets_owner`.
3. Confirm `GRANT datasheets_app TO datasheets_runtime WITH INHERIT FALSE`.
4. API must never `SET ROLE datasheets_owner` (including auth **register** — use
   `datasheets_app` + tenant GUC for company/membership inserts).
5. Keep migrate/seed credentials out of the API process environment.

## Commands

Run from the repo root (these proxy to this package):

- `pnpm db:generate` — generate a new Drizzle migration from `src/schema.ts` into `drizzle/`.
- `pnpm db:migrate` — apply pending SQL in `drizzle/` (idempotent, `_migrations`), then ensure
  `datasheets_runtime` exists with only `datasheets_app` (INHERIT FALSE). Does **not** grant
  `datasheets_owner` to the API runtime role.
- `pnpm db:seed` — insert demo data as `datasheets_owner` (requires superuser/migrate URL).
- `pnpm --filter @datasheets/db studio` — open Drizzle Studio.

`DATABASE_URL` for migrate/seed must be superuser (or `datasheets_migrate`-capable).
The application `DATABASE_URL` must be `datasheets_runtime`.

## Seed password

`pnpm db:seed` (`src/seed.ts`) reads **`SEED_PASSWORD`**:

- If set, all demo users get that password.
- If unset and `NODE_ENV !== 'production'`, defaults to `password123` and logs a warning.
- If unset and `NODE_ENV=production`, the script throws (no default password in production).
