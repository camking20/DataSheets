# DataSheets

Digital inspection data sheets and process capability tracking for manufacturing shops —
part revisions, dimensions with tolerances, lot-based measurements, process capability
(Pp/Ppk), and audit-ready traceability, replacing paper/Excel inspection sheets.

## Architecture

Turborepo + pnpm monorepo:

```
apps/
  api/            Fastify + tRPC backend (auth, parts, sheets, dashboard, exports)
  web/            Next.js 15 — dashboard, engineer admin, operator web flow
  mobile/         Expo iOS — operator measurement entry + local draft persistence
packages/
  core/           Shared domain logic: schemas, green/yellow/red, Pp/Ppk, sampling
  db/             Drizzle schema, SQL migrations (roles + RLS), seed
  exports/        CSV / Excel / PDF generators
```

- `packages/core` has zero DB/HTTP dependencies — pure functions and schemas shared by the
  API, web, and mobile clients.
- `packages/db` owns the schema, migrations, and the only supported way to talk to Postgres
  (`createDb`, `withTenant`, `withBypassRls`).
- `apps/api` exposes a typed tRPC API consumed by `apps/web` and `apps/mobile`.
- Build/test/lint is orchestrated by Turborepo (`turbo.json`); package boundaries are
  enforced via `workspace:*` deps declared in each `package.json`.

## Tenant isolation & DB roles

DataSheets is multi-tenant (one `companies` row per shop). Isolation is enforced in the
**database**, not just application code:

- Every tenant table's primary key is composite: `(company_id, id)`, and every FK between
  tenant tables is composite (`(company_id, parent_id)`) — a row physically cannot
  reference a parent in a different company.
- **Row-Level Security** is enabled + `FORCE`d on tenant tables, filtering on
  `company_id = current_company_id()` (a GUC-backed SQL function).
- Role separation (see `docker-compose.yml` comments and `packages/db/README.md`):
  - **`datasheets`** — container bootstrap **superuser**. Use **only** for
    `pnpm db:migrate` / `pnpm db:seed`. Never point the API at this URL in production
    (or local realism): superusers bypass RLS entirely.
  - **`datasheets_owner`** — table owner with `BYPASSRLS`. **Migration and seed only**
    (`SET ROLE` during those tools). The API login role must **not** be granted owner.
  - **`datasheets_app`** — DML role used inside transactions via
    `SET LOCAL ROLE datasheets_app` + `set_config('app.company_id', …)` (`asTenant` /
    `withTenant`). `NOBYPASSRLS`.
  - **`datasheets_runtime`** — **API connection role** (`LOGIN`, `NOSUPERUSER`,
    `NOBYPASSRLS`). Granted `datasheets_app` **WITH NOINHERIT** so the process must
    explicitly `SET LOCAL ROLE datasheets_app` per transaction. Default local password
    is `datasheets_runtime` (override in production).

**Intended / current model:** the running API connects as `datasheets_runtime` and must
never be granted `datasheets_owner`. Company bootstrap on register uses the
`SECURITY DEFINER` function `create_company_with_owner(...)` (see
`packages/db/drizzle/0003_register_company.sql`) so the API does not `SET ROLE`
owner for that path.

The API layer never lets `company_id` come from client input for tenant scoping. It is
always resolved server-side from the session token.

See `packages/db/README.md` for schema-level detail.

## Operational limits & labels

- **CORS** — set `CORS_ORIGINS` to a comma-separated allowlist (e.g.
  `http://localhost:3000,http://127.0.0.1:3000`). Do not use open `origin: true` in
  production.
- **Lot size** — capped at **10_000** pieces per sheet (Zod + DB check).
- **Capability labels** — UI/exports show **Pp / Ppk** (overall / long-term), computed
  from the sample standard deviation of all collected values for a dimension. Keys in
  `@datasheets/core` may still expose `cp`/`cpk` aliases for compatibility; treat those
  values as overall indices, not within-subgroup Cp/Cpk.
- **Email verification** (see `auth.verifyEmail` in `apps/api/src/routers/auth.ts`):
  - `auth.register` creates users with `emailVerified: false` and stores a verification
    token (TTL in `apps/api/src/auth.ts`). Non-production responses may include
    `devVerificationToken` for local testing.
  - Call `auth.verifyEmail({ token })` to mark the account verified.
  - `auth.login` rejects unverified users (`FORBIDDEN`: verify email first).
  - Dev-only: `auth.devVerifyEmail({ email })` when `NODE_ENV !== 'production'`.
  - Seeded demo users are inserted with `email_verified = true` so seed logins work.

## QMS / Document Control (Phase 1)

Phase 1 adds controlled documents, change requests, and Google Drive integration:

- **Google OAuth** — connect a Google account via `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` (callback at
  `http://localhost:4000/google/oauth/callback`). Tokens are stored encrypted with
  `APP_ENCRYPTION_KEY`.
- **MinIO** — local S3-compatible object storage (`docker compose up -d`). API on
  `:9000`, console on `:9001` (user `minio` / `minio12345`). The `minio-init`
  service creates the `datasheets` bucket. Configure via `S3_*` in `.env`.
- **Planned routes** — `/documents` (controlled docs), `/changes` (change requests),
  `/settings/integrations` (Google connect / disconnect).

## Prerequisites

- Node.js 20+
- pnpm (`corepack enable` or `npm i -g pnpm`)
- Docker (for local Postgres + MinIO) — or any reachable Postgres 16 instance

## Setup

```bash
cp .env.example .env        # API URL uses datasheets_runtime by default
docker compose up -d        # starts Postgres 16 on localhost:5432
pnpm install

# Migrate & seed need the container superuser (not datasheets_runtime):
DATABASE_URL=postgresql://datasheets:datasheets@localhost:5432/datasheets pnpm db:migrate
DATABASE_URL=postgresql://datasheets:datasheets@localhost:5432/datasheets pnpm db:seed

pnpm dev                    # runs all apps/packages in dev mode (turbo --parallel)
```

The API listens on `PORT` (default `4000`). Keep `DATABASE_URL` in `.env` pointed at
`datasheets_runtime` for `pnpm dev` / the API process.

Optional seed password override: `SEED_PASSWORD=…` (required when `NODE_ENV=production`).

## Seed logins

Seeded users share the password from `SEED_PASSWORD`, or `password123` when that env is
unset and `NODE_ENV !== 'production'`.

| Email | Company | Role | Notes |
|---|---|---|---|
| `admin@precision.local` | Precision Machine Works | admin | Has parts, revisions, dimensions |
| `operator@precision.local` | Precision Machine Works | operator | Same company as admin |
| `admin@apex.local` | Apex Aerospace CNC | admin | Separate tenant — used to demonstrate isolation |

## What's implemented vs deferred

**Implemented**

- Full DB schema, migrations, RLS policies, and roles (`packages/db`)
- Domain logic: tolerance/disposition, Pp/Ppk (overall), sampling (`packages/core`, Vitest)
- Auth, parts/revisions/dimensions, sheets, dashboard, exports tRPC routers (`apps/api`)
- Cross-tenant isolation test suite (`apps/api/src/isolation.test.ts`)
- CSV / Excel / PDF exports (`packages/exports`)
- Next.js web app: dashboard, engineer admin, operator inspect flow (`apps/web`)
- Expo iOS operator app with local draft persistence (`apps/mobile`)
- Seed data covering two tenants for isolation demos

**Deferred**

- Offline-first sync, gage/DRO Bluetooth, AQL (ANSI Z1.4)
- Nelson control-chart rules beyond the warning band
- Customer-facing report portals, billing, hardened production email delivery
- CI/CD and production deployment infra

## How isolation is enforced (quick reference)

1. Client authenticates → API resolves a session → session carries `activeCompanyId`.
2. Every tenant-scoped resolver calls `asTenant(db, companyId, fn)`, which opens a
   transaction, sets `ROLE datasheets_app`, and sets `app.company_id` via `SET LOCAL`
   (transaction-scoped, never leaks across requests). The process itself should be
   connected as **`datasheets_runtime`**, not the `datasheets` superuser.
3. Postgres RLS policies filter every row by `company_id = current_company_id()`; composite
   FKs make it impossible to store a row that points at another tenant's parent row even if
   a bug bypassed the application layer.
4. Migrations/seeding connect as the container superuser and `SET ROLE datasheets_owner`
   (bypasses RLS by ownership / `BYPASSRLS`). That role is for migrate/seed tooling — not
   the steady-state API connection.
