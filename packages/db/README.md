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
- Two Postgres roles are created in `drizzle/0000_foundation.sql`:
  - `datasheets_owner` — owns all tables and has the `BYPASSRLS` attribute
    (required because RLS is `FORCE`d, which would otherwise apply to the owner too).
    Used only for migrations and seeding (`0001_owner_bypass.sql`).
  - `datasheets_app` — the runtime role. `NOBYPASSRLS`, DML-only grants, RLS-enforced.
    The API sets `SET LOCAL ROLE datasheets_app` and
    `SELECT set_config('app.company_id', ..., true)` inside every transaction
    (see `withTenant` / `asTenant` helpers), scoped to that transaction only.
- `company_id` is **never** accepted from client input for scoping reads/writes — it is
  always derived from the authenticated session and set via `SET LOCAL` before any query.

## Commands

Run from the repo root (these proxy to this package):

- `pnpm db:generate` — generate a new Drizzle migration from `src/schema.ts` into `drizzle/`.
- `pnpm db:migrate` — apply all pending SQL files in `drizzle/` (idempotent, tracked in
  `_migrations`), then grant `datasheets_owner` / `datasheets_app` to the connecting user
  so local development can `SET ROLE` freely.
- `pnpm db:seed` — insert demo companies/users/parts as `datasheets_owner` (bypasses RLS).
- `pnpm --filter @datasheets/db studio` — open Drizzle Studio.

`DATABASE_URL` must point at a superuser/owner-capable connection for `migrate` and `seed`;
the application itself should connect with a role that can `SET ROLE datasheets_app`.
