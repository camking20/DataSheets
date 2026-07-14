# DataSheets

Digital inspection data sheets and process capability tracking for manufacturing shops —
part revisions, dimensions with tolerances, lot-based measurements, Cpk/Cp capability, and
audit-ready traceability, replacing paper/Excel inspection sheets.

## Architecture

Turborepo + pnpm monorepo:

```
apps/
  api/            Fastify + tRPC backend (auth, parts, sheets, dashboard, exports)
  web/            Next.js 15 — dashboard, engineer admin, operator web flow
  mobile/         Expo iOS — operator measurement entry + local draft persistence
packages/
  core/           Shared domain logic: schemas, green/yellow/red, Cp/Cpk, sampling
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

## Tenant isolation

DataSheets is multi-tenant (one `companies` row per shop). Isolation is enforced in the
**database**, not just application code:

- Every tenant table's primary key is composite: `(company_id, id)`, and every FK between
  tenant tables is composite (`(company_id, parent_id)`) — a row physically cannot
  reference a parent in a different company.
- **Row-Level Security** is enabled + `FORCE`d on all tenant tables, filtering on
  `company_id = current_company_id()` (a GUC-backed SQL function).
- Two DB roles: `datasheets_owner` (migrations/seed, bypasses RLS via ownership) and
  `datasheets_app` (runtime, `NOBYPASSRLS`, DML grants only).
- The API layer never lets `company_id` come from client input. Every tenant query runs
  inside a transaction that does `SET LOCAL ROLE datasheets_app` and
  `set_config('app.company_id', <session's company>, true)` — see `asTenant()` in
  `apps/api/src/trpc.ts` and `withTenant()` in `packages/db/src/client.ts`. The company id
  is always resolved server-side from the session token.

See `packages/db/README.md` for schema-level detail.

## Prerequisites

- Node.js 20+
- pnpm (`corepack enable` or `npm i -g pnpm`)
- Docker (for local Postgres) — or any reachable Postgres 16 instance

## Setup

```bash
cp .env.example .env        # adjust DATABASE_URL if not using the default docker-compose creds
docker compose up -d        # starts Postgres 16 on localhost:5432
pnpm install
pnpm db:migrate             # applies schema, roles, and RLS policies
pnpm db:seed                # inserts demo companies/users/parts
pnpm dev                    # runs all apps/packages in dev mode (turbo --parallel)
```

The API listens on `PORT` (default `4000`).

## Seed logins

All seeded users share the password `password123`.

| Email | Company | Role | Notes |
|---|---|---|---|
| `admin@precision.local` | Precision Machine Works | admin | Has parts, revisions, dimensions |
| `operator@precision.local` | Precision Machine Works | operator | Same company as admin |
| `admin@apex.local` | Apex Aerospace CNC | admin | Separate tenant — used to demonstrate isolation |

## What's implemented vs deferred

**Implemented**

- Full DB schema, migrations, RLS policies, and roles (`packages/db`)
- Domain logic: tolerance/disposition, Cp/Cpk, sampling (`packages/core`, Vitest)
- Auth, parts/revisions/dimensions, sheets, dashboard, exports tRPC routers (`apps/api`)
- Cross-tenant isolation test suite (`apps/api/src/isolation.test.ts`)
- CSV / Excel / PDF exports (`packages/exports`)
- Next.js web app: dashboard, engineer admin, operator inspect flow (`apps/web`)
- Expo iOS operator app with local draft persistence (`apps/mobile`)
- Seed data covering two tenants for isolation demos

**Deferred**

- Offline-first sync, gage/DRO Bluetooth, AQL (ANSI Z1.4)
- Nelson control-chart rules beyond the warning band
- Customer-facing report portals, billing, hardened rate limiting / email delivery
- CI/CD and production deployment infra

## How isolation is enforced (quick reference)

1. Client authenticates → API resolves a session → session carries `activeCompanyId`.
2. Every tenant-scoped resolver calls `asTenant(db, companyId, fn)`, which opens a
   transaction, sets `ROLE datasheets_app`, and sets `app.company_id` via `SET LOCAL`
   (transaction-scoped, never leaks across requests).
3. Postgres RLS policies filter every row by `company_id = current_company_id()`; composite
   FKs make it impossible to store a row that points at another tenant's parent row even if
   a bug bypassed the application layer.
4. Migrations/seeding run as `datasheets_owner`, which bypasses RLS by table ownership —
   this role is never used by the running API.
