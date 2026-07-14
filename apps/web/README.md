# @datasheets/web

The DataSheets operator/engineer web app — Next.js 15 (App Router) + TypeScript + Tailwind CSS.

## Running locally

From the monorepo root:

```bash
pnpm install
pnpm --filter @datasheets/web dev
```

Or from this directory:

```bash
pnpm dev
```

The app runs at [http://localhost:3000](http://localhost:3000) and expects the API
(`apps/api`) to be running at `http://localhost:4000` (tRPC endpoint at `/trpc`).
Copy `.env.example` to `.env.local` if you need to point at a different API host:

```bash
cp .env.example .env.local
```

## Pages

| Route | Description |
| --- | --- |
| `/` | Marketing landing page |
| `/login`, `/register` | Auth — creates a session token stored in `localStorage` (`ds_token`) |
| `/dashboard` | Company command center — KPIs, alerts, part Cpk, in-progress sheets |
| `/parts`, `/parts/[id]` | Part list, revision history, branch/release actions |
| `/parts/[id]/revisions/[revId]` | Dimension (tolerance) editor for a draft revision |
| `/inspect` | Operator flow — look up a part, enter lot info, start a sheet |
| `/sheets`, `/sheets/[id]` | Sheet list and the live measurement entry / Cpk / export view |

## Architecture notes

- **Data fetching**: `@trpc/react-query` + `@tanstack/react-query`, configured in
  `src/lib/trpc.ts` with `httpBatchLink` + `superjson`, pointed at
  `NEXT_PUBLIC_API_URL`. The auth token is attached as a `Bearer` header on every
  request.
- **Typing against the API**: `apps/api` doesn't currently export a shared
  `AppRouter` type (no `root.ts` combining its routers), so importing it directly
  would be a fragile relative import across app boundaries. `src/lib/api-types.ts`
  keeps a hand-maintained mirror of the request/response shapes instead — full
  autocomplete and type checking in every page, with the underlying tRPC proxy
  client kept loosely typed against the live API.
- **Instant SPC feedback**: measurement cells call `evaluateDisposition` from
  `@datasheets/core` synchronously as the operator types, before the mutation to
  the API even resolves. Per-dimension Cp/Cpk mini-stats use `computeCapability`
  / `roundCapability` from the same package, recomputed from the samples visible
  on screen.
- **No mock data**: every page reads from the real tRPC API. If an endpoint isn't
  reachable (API down, or not yet implemented) pages render an explicit empty /
  error state rather than fabricating data.

## What's real vs. what the API still needs to implement

`apps/api` currently ships `auth.*` and `parts.*` routers — those power `/login`,
`/register`, `/parts`, `/parts/[id]`, and the revision editor end to end today.

The following routers are **expected by this app but not yet implemented
server-side** (see the contract documented in `src/lib/api-types.ts`):

- `dashboard.summary` — powers `/dashboard`
- `sheets.list`, `sheets.create`, `sheets.getById`, `sheets.recordMeasurement`,
  `sheets.complete`, `sheets.exportFile` — power `/inspect`, `/sheets`, and
  `/sheets/[id]`

Until those exist, the corresponding pages render a clear empty/error state
instead of mock data. Implement them in `apps/api/src/routers` using the same
`tenantProcedure` / `requireRoles` / `asTenant` patterns as `parts.ts`, and these
pages will light up without any frontend changes.

## Scripts

- `pnpm dev` — start the dev server on port 3000
- `pnpm build` — production build
- `pnpm start` — run the production build (port 3000)
- `pnpm lint` — run ESLint
